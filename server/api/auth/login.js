const { exec } = require('child_process');
const path = require('path');

// ipatool二进制文件路径
const IPATOOL_PATH = path.join(__dirname, '../../bin/ipatool');
const { KEYCHAIN_PASSPHRASE } = require('../../config/keychain');
const {
    appleAccountIdFromEmail,
    setAppleAccountCookie,
    ipatoolEnvForAccount,
    writeAccountMeta,
    wipeIpatoolSession,
} = require('../../utils/appleAccount');
const { wantsStoreSession, readIpatoolStoreSession } = require('../../utils/readIpatoolAccount');

const LOGIN_TIMEOUT_MS = 240000;

function isTwoFactorRequired(output = '') {
    if (!output || typeof output !== 'string') {
        return false;
    }

    const normalized = output.toLowerCase();
    return (
        normalized.includes('2fa code is required') ||
        normalized.includes('--auth-code') ||
        normalized.includes('auth-code') ||
        normalized.includes('auth code') ||
        normalized.includes('two-factor') ||
        normalized.includes('two factor') ||
        normalized.includes('verification code') ||
        normalized.includes('security code') ||
        normalized.includes('trusted device') ||
        normalized.includes('trusted phone') ||
        normalized.includes('needstwofactor')
    );
}

function extractIpatoolFields(content = '') {
    const json = parseJsonSafely(content);
    if (!json || typeof json !== 'object') {
        return { message: '', error: '' };
    }

    return {
        message: typeof json.message === 'string' ? json.message : '',
        error: typeof json.error === 'string' ? json.error : '',
        needsTwoFactor: Boolean(json.needsTwoFactor),
    };
}

function describeLoginFailure(stdout = '', stderr = '', execMessage = '') {
    const fromStdout = extractIpatoolFields(stdout);
    const fromStderr = extractIpatoolFields(stderr);
    const combined = [
        fromStdout.error,
        fromStdout.message,
        fromStderr.error,
        fromStderr.message,
        stdout,
        stderr,
        execMessage,
    ].filter(Boolean).join('\n');

    if (isTwoFactorRequired(combined)) {
        return null;
    }

    const normalized = combined.toLowerCase();
    if (
        normalized.includes('no such file or directory') ||
        normalized.includes('enoent') ||
        normalized.includes('error relocating') ||
        normalized.includes('not found')
    ) {
        return '容器内 ipatool 无法运行。官方 2.5.0 需要 glibc，请更新到 Debian 基础镜像。';
    }

    if (
        normalized.includes('something went wrong') ||
        normalized.includes('http 403') ||
        normalized.includes('empty or non-plist') ||
        normalized.includes('x-apple-actionsignature')
    ) {
        return 'Apple 认证失败（HTTP 403 / SAP）。容器需要官方 ipatool 2.5.0 或更新版本。';
    }

    if (
        (normalized.includes('password') && (normalized.includes('incorrect') || normalized.includes('invalid'))) ||
        normalized.includes('authentication failed')
    ) {
        return 'Apple ID 或密码不正确';
    }

    const human = fromStdout.error || fromStdout.message || fromStderr.error || fromStderr.message;
    if (human && human.toLowerCase() !== 'something went wrong') {
        return human;
    }

    return 'Apple ID 登录失败，请检查账号、网络或容器内 ipatool 版本';
}

function parseJsonSafely(content = '') {
    if (!content || typeof content !== 'string') {
        return null;
    }

    try {
        return JSON.parse(content);
    } catch (_) {
        return null;
    }
}

/**
 * 执行ipatool命令的通用函数
 * @param {string} command - 要执行的命令
 * @returns {Promise} 返回Promise对象
 */
function executeIpatool(command, execOptions = {}) {
    return new Promise((resolve, reject) => {
        exec(command, { timeout: 30000, ...execOptions }, (error, stdout, stderr) => {
            const jsonStdout = parseJsonSafely(stdout);
            const jsonStderr = parseJsonSafely(stderr);
            const combinedOutput = `${stdout || ''}\n${stderr || ''}`;

            if (error) {
                const jsonMessage = [
                    jsonStdout?.message,
                    jsonStdout?.error,
                    jsonStderr?.message,
                    jsonStderr?.error,
                ].filter(Boolean).join('\n');
                const needsTwoFactor = Boolean(
                    jsonStdout?.needsTwoFactor ||
                    jsonStderr?.needsTwoFactor ||
                    isTwoFactorRequired(jsonMessage) ||
                    isTwoFactorRequired(combinedOutput)
                );

                // 检查是否是需要2FA的错误
                if (needsTwoFactor) {
                    resolve({
                        success: false,
                        needsTwoFactor: true,
                        message: '需要二次验证码',
                        rawOutput: combinedOutput
                    });
                } else {
                    reject({
                        success: false,
                        error: error.message,
                        stderr: stderr,
                        stdout: stdout
                    });
                }
            } else {
                try {
                    // 尝试解析JSON输出
                    const result = jsonStdout || JSON.parse(stdout);
                    resolve({
                        success: true,
                        data: result
                    });
                } catch (parseError) {
                    // 如果不是JSON格式，返回原始输出
                    resolve({
                        success: true,
                        rawOutput: stdout
                    });
                }
            }
        });
    });
}

async function attachStoreSession(req, data, accountId) {
    if (!wantsStoreSession(req)) {
        return data;
    }

    const session = await readIpatoolStoreSession(accountId);
    if (!session) {
        return {
            ...data,
            sessionExportError: 'ipatool 钥匙串里没有可读的商店会话',
        };
    }

    return {
        ...data,
        ...session,
        password: undefined,
    };
}

/**
 * 登录
 */
async function loginHandler(req, res) {
    try {
        const { email, password, twoFactor } = req.body;

        // 参数验证
        if (!email || !password) {
            return res.status(400).json({
                error: 'Bad Request',
                message: '邮箱和密码是必需的参数'
            });
        }

        if (!String(email).includes('@')) {
            return res.status(400).json({
                success: false,
                message: '请填写完整的 Apple ID 邮箱，例如 name@example.com'
            });
        }

        const accountId = appleAccountIdFromEmail(email);
        const execEnv = { env: ipatoolEnvForAccount(accountId) };

        // 不要在每次登录前 wipe：下午 SAP 刚修好时能下载的会话，就是被反复清钥匙串冲掉的。

        // 构建ipatool命令
        // 必须用 --email= / --password=。短参数 -e/-p 时 ipatool 常不向苹果要验证码。
        const escapedEmail = String(email).replace(/"/g, '\\"');
        const escapedPassword = String(password).replace(/"/g, '\\"');
        let command = `"${IPATOOL_PATH}" auth login --email="${escapedEmail}" --password="${escapedPassword}" --keychain-passphrase "${KEYCHAIN_PASSPHRASE}" --non-interactive --format "json"`;

        // 如果提供了二次验证码，添加到命令中
        if (twoFactor) {
            // 2FA验证码仅允许数字，避免参数异常并提升兼容性
            const sanitizedTwoFactor = String(twoFactor).replace(/\D/g, '').slice(0, 8);
            command += ` --auth-code "${sanitizedTwoFactor}"`;
        }

        // console.log(`执行登录命令: ${command.replace(password, '***').replace(twoFactor || '', '***')}`);

        try {
            const result = await executeIpatool(command, {
                ...execEnv,
                timeout: LOGIN_TIMEOUT_MS,
            });

            if (result.success) {
                // 检查返回的数据中是否包含2FA要求
                const resultData = result.data || {};
                const resultHint = [resultData.message, resultData.error, result.rawOutput]
                    .filter(Boolean)
                    .join('\n');
                if (isTwoFactorRequired(resultHint)) {
                    // 处理message，移除分号后的内容
                    const rawMessage = resultData.message || resultData.error || resultHint;
                    const cleanMessage = String(rawMessage).split(';')[0];
                    return res.status(200).json({
                        success: false,
                        needsTwoFactor: true,
                        message: '请求错误 / 请输入二次验证码',
                        data: {
                            ...resultData,
                            message: cleanMessage
                        }
                    });
                }

                // 真正的登录成功，获取用户信息
                const infoCommand = `"${IPATOOL_PATH}" auth info --keychain-passphrase "${KEYCHAIN_PASSPHRASE}" --non-interactive --format "json"`;

                try {
                    const infoResult = await executeIpatool(infoCommand, execEnv);

                    if (infoResult.success) {
                        setAppleAccountCookie(res, accountId);
                        writeAccountMeta(accountId, {
                            email: infoResult.data?.email || email,
                        });
                        return res.json({
                            success: true,
                            message: '登录成功',
                            data: await attachStoreSession(req, {
                                ...infoResult.data,
                                accountId,
                            }, accountId)
                        });
                    } else {
                        setAppleAccountCookie(res, accountId);
                        writeAccountMeta(accountId, { email });
                        // 登录成功但获取信息失败
                        return res.json({
                            success: true,
                            message: '登录成功，但获取用户信息失败',
                            data: await attachStoreSession(req, {
                                ...(typeof result.data === 'object' && result.data ? result.data : {}),
                                accountId,
                            }, accountId)
                        });
                    }
                } catch (infoError) {
                    setAppleAccountCookie(res, accountId);
                    writeAccountMeta(accountId, { email });
                    // 登录成功但获取信息出错
                    return res.json({
                        success: true,
                        message: '登录成功，但获取用户信息时出错',
                        data: await attachStoreSession(req, {
                            ...(typeof result.data === 'object' && result.data ? result.data : {}),
                            accountId,
                        }, accountId)
                    });
                }
            } else if (result.needsTwoFactor) {
                // 需要二次验证
                return res.status(200).json({
                    success: false,
                    needsTwoFactor: true,
                    message: '请求错误 / 请输入二次验证码'
                });
            } else {
                // 其他登录失败情况
                return res.status(401).json({
                    success: false,
                    message: '登录失败',
                    error: result.error || '未知错误'
                });
            }
        } catch (execError) {
            console.error('执行ipatool命令时出错:', execError?.stdout);

            // 检查错误信息中是否包含2FA相关内容
            if (isTwoFactorRequired(`${execError.stdout || ''}\n${execError.stderr || ''}`)) {
                return res.status(200).json({
                    success: false,
                    needsTwoFactor: true,
                    message: '请求错误 / 请输入二次验证码'
                });
            }

            const friendlyMessage = describeLoginFailure(
                execError?.stdout || '',
                execError?.stderr || '',
                execError?.error || execError?.message || ''
            ) || 'APPLE ID 登录过程中发生错误';

            return res.status(500).json({
                success: false,
                message: friendlyMessage,
                error: '执行命令失败'
            });
        }

    } catch (error) {
        // console.error('登录错误:', error);
        return res.status(500).json({
            success: false,
            message: '服务器内部错误',
            error: error.message
        });
    }
}

module.exports = loginHandler;
