const { execFile } = require('child_process');
const path = require('path');
const { KEYCHAIN_PASSPHRASE } = require('../config/keychain');

const IPATOOL_PATH = path.join(__dirname, '../bin/ipatool');

function withKeychain(args, passphrase = KEYCHAIN_PASSPHRASE) {
    return [
        ...args,
        `--keychain-passphrase=${passphrase == null ? '' : String(passphrase)}`,
        '--non-interactive',
        '--format',
        'json',
    ];
}

function buildLoginArgs({ email, password, twoFactor, passphrase = KEYCHAIN_PASSPHRASE }) {
    const args = withKeychain([
        'auth',
        'login',
        `--email=${String(email)}`,
        `--password=${String(password)}`,
    ], passphrase);

    if (twoFactor != null && String(twoFactor).length > 0) {
        const code = String(twoFactor).replace(/\D/g, '').slice(0, 8);
        if (code) {
            args.push('--auth-code', code);
        }
    }

    return args;
}

function buildAuthInfoArgs(passphrase = KEYCHAIN_PASSPHRASE) {
    return withKeychain(['auth', 'info'], passphrase);
}

function buildAuthRevokeArgs(passphrase = KEYCHAIN_PASSPHRASE) {
    return withKeychain(['auth', 'revoke'], passphrase);
}

function redactCommandText(text) {
    return String(text || '')
        .replace(/--password(?:=|\s+)\S+/gi, '--password=[redacted]')
        .replace(/--keychain-passphrase(?:=|\s+)\S+/gi, '--keychain-passphrase=[redacted]')
        .replace(/--email(?:=|\s+)\S+/gi, '--email=[redacted]')
        .replace(/--auth-code(?:=|\s+)\S+/gi, '--auth-code=[redacted]');
}

/**
 * 用参数数组执行 ipatool，不经过 shell。
 * options.execFile 仅供隔离测试注入，请求数据不能到达这里。
 */
function runIpatool(args, options = {}) {
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
        return Promise.reject(Object.assign(new Error('ipatool args must be strings'), {
            stdout: '',
            stderr: '',
        }));
    }

    const execFileImpl = options.execFile || execFile;
    const execOptions = {
        timeout: options.timeout || 30000,
        env: options.env,
        shell: false,
        windowsHide: true,
    };
    if (options.cwd) {
        execOptions.cwd = options.cwd;
    }

    return new Promise((resolve, reject) => {
        execFileImpl(IPATOOL_PATH, args, execOptions, (error, stdout, stderr) => {
            const out = stdout || '';
            const err = stderr || '';
            if (error) {
                const failure = new Error('ipatool exited');
                failure.stdout = out;
                failure.stderr = err;
                failure.code = error.code;
                reject(failure);
                return;
            }
            resolve({ stdout: out, stderr: err });
        });
    });
}

module.exports = {
    IPATOOL_PATH,
    withKeychain,
    buildLoginArgs,
    buildAuthInfoArgs,
    buildAuthRevokeArgs,
    redactCommandText,
    runIpatool,
};
