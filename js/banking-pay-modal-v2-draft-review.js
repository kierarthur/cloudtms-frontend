/* The candidate summary is a bounded display, not a complete payment list.
 * Capture its accepted revision for the unchanged Create Draft owner, which
 * rereads the complete physical Ready + Blocked selection before its POST.
 * The controller must publish this snapshot in the same synchronous commit as
 * the summary and legacy session aliases. This module cannot enable Draft,
 * invent first_page_applied, change selection or construct a Draft request.
 */
(function(root){
  'use strict';
  const table=typeof module==='object'&&module.exports?require('./banking-pay-modal-v2-table.js'):root.CloudTMSBankingPayTableV2;
  function selectionReviewSnapshot(summary){
    table.validateSummary(summary);
    return Object.freeze({
      session_id:summary.session_id,
      session_version:summary.session_version,
      progress_counter_version:summary.progress_counter_version,
      selected_preview_row_ids:Object.freeze([]),
      selected_set_complete:false,
      captured_from_rendered_workbench:true
    });
  }
  const api=Object.freeze({selectionReviewSnapshot});
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CloudTMSBankingPayDraftReviewV2=api;
})(typeof globalThis==='object'?globalThis:this);
