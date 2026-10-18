const {
    appleAccountIdFromEmail,
    setAppleAccountCookie,
    ipatoolEnvForAccount,
    writeAccountMeta,
} = require('../../utils/appleAccount');
const { readIpatoolStoreSession } = require('../../utils/readIpatoolAccount');
const { canExportStoreSession } = require('../../utils/requestGuards');
const {
    buildLoginArgs,
    buildAuthInfoArgs,
    redactCommandText,
    runIpatool,
} = require('../../utils/ipatoolExec');

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

    const human = redactCommandText(fromStdout.error || fromStdout.message || fromStderr.error || fromStderr.message);
    if (human && human.toLowerCase() !== 'something went wrong' && !/passwordtoken|cookie|dspersonid|directoryservicesidentifier/i.test(human)) {
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
const SECRET_FIELDS = new Set([
    'password',
    'passwordToken',
    'cookies',
    'cookie',
    'dsPersonId',
    'directoryServicesIdentifier',
]);

function omitStoreSecrets(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return data;
    }
    const copy = {};
    for (const [key, value] of Object.entries(data)) {
        if (!SECRET_FIELDS.has(key)) {
            copy[key] = value;
        }
    }
    return copy;
}

function executeIpatool(args, execOptions = {}) {
    return runIpatool(args, { timeout: 30000, ...execOptions }).then(({ stdout, stderr }) => {
        const jsonStdout = parseJsonSafely(stdout);
        try {
            const result = jsonStdout || JSON.parse(stdout);
            return {
                success: true,
                data: result,
            };
        } catch (_) {
            return {
                success: true,
                rawOutput: stdout,
                stderr,
            };
        }
    }).catch((failure) => {
        const stdout = failure.stdout || '';
        const stderr = failure.stderr || '';
        const jsonStdout = parseJsonSafely(stdout);
        const jsonStderr = parseJsonSafely(stderr);
        const combinedOutput = `${stdout}\n${stderr}`;
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

        if (needsTwoFactor) {
            return {
                success: false,
                needsTwoFactor: true,
                message: '需要二次验证码',
                rawOutput: redactCommandText(combinedOutput),
            };
        }

        return Promise.reject({
            success: false,
            error: 'ipatool exited',
            stderr,
            stdout,
        });
    });
}

async function attachStoreSession(req, data, accountId) {
    if (!canExportStoreSession(req)) {
        return omitStoreSecrets(data);
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

        // 本地钥匙串已经可读时直接交还会话，不再向苹果做全新认证。
        // 网页和 App 都走这里。没有会话、或用户正在提交验证码时，才继续原来的 ipatool 登录。
        if (!twoFactor) {
            const existing = await readIpatoolStoreSession(accountId);
            const storedEmail = String(existing?.email || '').trim().toLowerCase();
            const requestedEmail = String(email).trim().toLowerCase();
            if (existing && (!storedEmail || storedEmail === requestedEmail)) {
                setAppleAccountCookie(res, accountId);
                writeAccountMeta(accountId, { email: storedEmail || requestedEmail });
                console.log(`复用已有商店会话: ${accountId}`);
                return res.json({
                    success: true,
                    message: '登录成功',
                    data: await attachStoreSession(req, {
                        email: storedEmail || requestedEmail,
                        name: existing.name,
                        accountId,
                    }, accountId),
                });
            }
        }

        // 不要在每次登录前 wipe：下午 SAP 刚修好时能下载的会话，就是被反复清钥匙串冲掉的。
        // 必须用 --email= / --password=。短参数 -e/-p 时 ipatool 常不向苹果要验证码。
        const loginArgs = buildLoginArgs({ email, password, twoFactor });

        try {
            const result = await executeIpatool(loginArgs, {
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
                    const rawMessage = resultData.message || resultData.error || '';
                    const cleanMessage = redactCommandText(String(rawMessage).split(';')[0]);
                    return res.status(200).json({
                        success: false,
                        needsTwoFactor: true,
                        message: '请求错误 / 请输入二次验证码',
                        data: {
                            message: cleanMessage
                        }
                    });
                }

                // 真正的登录成功，获取用户信息
                const infoArgs = buildAuthInfoArgs();

                try {
                    const infoResult = await executeIpatool(infoArgs, execEnv);

                    if (infoResult.success) {
                        setAppleAccountCookie(res, accountId);
                        writeAccountMeta(accountId, {
                            email: infoResult.data?.email || email,
                        });
                        return res.json({
                            success: true,
                            message: '登录成功',
                            data: await attachStoreSession(req, {
                                ...omitStoreSecrets(infoResult.data),
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
                                ...omitStoreSecrets(typeof result.data === 'object' && result.data ? result.data : {}),
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
                            ...omitStoreSecrets(typeof result.data === 'object' && result.data ? result.data : {}),
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
            console.error('执行ipatool登录命令失败');

            // 检查错误信息中是否包含2FA相关内容
            if (isTwoFactorRequired(`${execError.stdout || ''}\n${execError.stderr || ''}`)) {
                return res.status(200).json({
                    success: false,
                    needsTwoFactor: true,
                    message: '请求错误 / 请输入二次验证码'
                });
            }

            const friendlyMessage = describeLoginFailure(
                redactCommandText(execError?.stdout || ''),
                redactCommandText(execError?.stderr || ''),
                ''
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
            error: '内部错误'
        });
    }
}

module.exports = loginHandler;
