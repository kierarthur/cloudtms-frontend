(() => {
  'use strict';
  let promise = null;
  let bootstrapGeneration = 0;
  async function bootstrapCandidateOffice({ force = false } = {}) {
    if (force) {
      promise = null;
      window.CloudTMSCandidateOfficeBridge?.deactivate?.();
    }
    if (promise) return promise;
    const requestedGeneration = ++bootstrapGeneration;
    promise = (async () => {
      try {
        const capabilities = await window.CloudTMSCandidateOfficeApi.fetchOfficeCandidateCapabilities();
        if (requestedGeneration !== bootstrapGeneration) {
          return Object.freeze({ active: false, stale: true, reason: 'SESSION_GENERATION_REPLACED' });
        }
        if (!capabilities.authority_applies || !capabilities.permissions.view_candidate_state) return Object.freeze({ active: false, reason: 'AUTHORITY_DOES_NOT_APPLY', capabilities });
        window.CloudTMSCandidateOfficeBridge.initialize(capabilities);
        document.documentElement.dataset.candidateOfficeContract = capabilities.contract_version;
        delete document.documentElement.dataset.candidateOfficeUnavailable;
        return Object.freeze({ active: true, capabilities });
      } catch (error) {
        if (requestedGeneration !== bootstrapGeneration) {
          return Object.freeze({ active: false, stale: true, reason: 'SESSION_GENERATION_REPLACED' });
        }
        window.CloudTMSCandidateOfficeBridge?.deactivate?.();
        const normalized = window.CloudTMSCandidateOfficeContract.normalizeCandidateOfficeError(error);
        document.documentElement.dataset.candidateOfficeUnavailable = normalized.code;
        console.warn('[CANDIDATE-OFFICE] unavailable', normalized.code);
        if (normalized.auth || normalized.status === 403) promise = null;
        return Object.freeze({ active: false, error: normalized });
      }
    })();
    return promise;
  }
  Object.assign(window, { CloudTMSCandidateOfficeBootstrap: Object.freeze({ bootstrapCandidateOffice }) });
  window.addEventListener('cloudtms:office-session-ready', () => bootstrapCandidateOffice({ force: true }));
  window.addEventListener('cloudtms:office-session-cleared', () => {
    bootstrapGeneration += 1;
    promise = null;
    window.CloudTMSCandidateOfficeBridge?.deactivate?.();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => bootstrapCandidateOffice(), { once: true });
  else bootstrapCandidateOffice();
})();
