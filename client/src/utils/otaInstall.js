import Swal from 'sweetalert2';
import isValidDomain from 'is-valid-domain';
import { createSignedInstallLink } from './api';

export function isOtaInstallAvailable() {
    if (typeof window === 'undefined') return false;
    return window.isSecureContext && isValidDomain(window.location.hostname);
}

/**
 * OTA 安装或回退为下载 IPA（与 App 详情、下载库卡片共用）
 * @param {object} opts
 * @param {string|number} opts.trackId App Store trackId
 * @param {string} opts.versionId 外部版本 id 或 latest
 * @param {string|null|undefined} opts.accountId
 * @param {import('i18next').TFunction} opts.t
 */
async function loadSignedLinks({ trackId, versionId, accountId, t }) {
    if (!accountId) {
        void Swal.fire({
            icon: 'warning',
            title: t('ui.appleIdLogin'),
            confirmButtonText: t('ui.confirm'),
        });
        return null;
    }
    try {
        const result = await createSignedInstallLink(trackId, versionId, accountId);
        return result.data;
    } catch (error) {
        void Swal.fire({
            icon: 'error',
            title: t('ui.getDetailsFailed'),
            text: error.message,
            confirmButtonText: t('ui.confirm'),
        });
        return null;
    }
}

export async function openSignedDownload({ trackId, versionId, accountId, t }) {
    const links = await loadSignedLinks({ trackId, versionId, accountId, t });
    if (links?.downloadUrl) {
        window.open(links.downloadUrl, '_blank');
    }
}

export async function openInstallOrDownloadChoice({ trackId, versionId, accountId, t }) {
    const links = await loadSignedLinks({ trackId, versionId, accountId, t });
    if (!links?.installUrl || !links?.downloadUrl) {
        return;
    }
    if (!isOtaInstallAvailable()) {
        window.open(links.downloadUrl, '_blank');
        return;
    }
    const installUrl = links.installUrl;
    const downloadUrl = links.downloadUrl;
    void Swal.fire({
        title: t('ui.installOrDownload'),
        text: t('ui.pleaseSelect'),
        icon: 'question',
        showCancelButton: false,
        showConfirmButton: false,
        html: `
      <div style="display:flex; justify-content:center; gap:12px; padding:1rem; flex-wrap: wrap;">
        <a href="${installUrl}"
        class="swal2-confirm swal2-styled"
           style="
             display:inline-block;
             background-color:var(--swal2-confirm-button-background-color);
             color:white;
             padding:8px 16px;
             border-radius:4px;
             text-decoration:none;
             font-size:14px;
           ">
           ${t('ui.install')}
        </a>

        <a href="${downloadUrl}"
                  class="swal2-cancel swal2-styled"
 style="
             display:inline-block;
             background-color:var(--swal2-cancel-button-background-color);
             color:white;
             padding:8px 16px;
             border-radius:4px;
             text-decoration:none;
             font-size:14px;
           ">
           ${t('ui.downloadIPA')}
        </a>
      </div>
    `,
    });
}
