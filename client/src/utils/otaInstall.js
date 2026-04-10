import Swal from 'sweetalert2';
import isValidDomain from 'is-valid-domain';
import { getAppInstallPackageUrl, getAppDownloadPackageUrl } from './api';

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
export function openInstallOrDownloadChoice({ trackId, versionId, accountId, t }) {
    if (!accountId) {
        void Swal.fire({
            icon: 'warning',
            title: t('ui.appleIdLogin'),
            confirmButtonText: t('ui.confirm'),
        });
        return;
    }
    if (!isOtaInstallAvailable()) {
        window.open(getAppDownloadPackageUrl(trackId, versionId, accountId), '_blank');
        return;
    }
    const installUrl = getAppInstallPackageUrl(trackId, versionId, accountId);
    const downloadUrl = getAppDownloadPackageUrl(trackId, versionId, accountId);
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
