/* Compact Action Required / Blocked presentation. It does not classify rows,
 * calculate amounts, select payments, filter data or sort a loaded page.
 * All queries and detail actions go through the one parent controller.
 */
(function(root){
  'use strict';
  const local=typeof module==='object'&&module.exports;
  const table=local?require('./banking-pay-modal-v2-table.js'):root.CloudTMSBankingPayTableV2;
  const copy=local?require('./banking-pay-modal-v2-copy.js'):root.CloudTMSBankingPayCopyV2;
  const definitions=Object.freeze({
    actions:Object.freeze({title:copy.message('MSG-001'),noun:'tasks',empty:'MSG-003',
      columns:Object.freeze([
        ['CANDIDATE','Candidate','CANDIDATES'],
        ['PAYMENT','Payment','PAYMENTS'],
        ['ATTENTION','What needs attention','TITLE'],
        ['AMOUNT','Amount','AMOUNT']
      ])}),
    blocked:Object.freeze({title:'Blocked for Pay',noun:'payments',empty:'MSG-015',
      columns:Object.freeze([['CANDIDATE','Candidate','CANDIDATE'],['REASON','Reason','REASON'],['AMOUNT','Amount','AMOUNT']])})
  });
  const fields=['session_id','session_version','progress_counter_version','scope_hash'];
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const count=value=>Number.isSafeInteger(value)&&value>=0;
  const text=value=>typeof value==='string'&&value.trim().length>0;
  const token=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,4096}$/.test(value);
  const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  function requireValue(value){if(!value)throw new Error('BANKING_PAY_V2_INVALID_RESPONSE');}
  const validPaymentCount=row=>typeof row.affected_payment_count_complete==='boolean'
    &&(row.affected_payment_count_complete?count(row.affected_payment_count):row.affected_payment_count===null);
  const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
  const displayDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))
    ?`${value.slice(8,10)}/${value.slice(5,7)}/${value.slice(0,4)}`:'';
  function validateRow(row,kind){
    requireValue(object(row)&&token(row.identity)&&row.indefinite_snooze!==true&&row.updating!==true);
    if(kind==='actions'){
      requireValue(text(row.title)&&count(row.affected_candidate_count)&&row.affected_candidate_count>0
        &&validPaymentCount(row)&&['ACTION_REQUIRED','UPDATING'].includes(row.issue_state));
      if(row.candidate_name!==undefined&&row.candidate_name!==null)requireValue(row.affected_candidate_count===1&&text(row.candidate_name));
      if(row.candidate_reference!==undefined&&row.candidate_reference!==null)requireValue(row.affected_candidate_count===1&&typeof row.candidate_reference==='string');
      if(row.payment_label!==undefined&&row.payment_label!==null)requireValue(row.affected_payment_count_complete&&row.affected_payment_count===1&&text(row.payment_label));
      if(row.payment_date!==undefined&&row.payment_date!==null)requireValue(row.affected_payment_count_complete&&row.affected_payment_count===1&&/^\d{4}-\d{2}-\d{2}$/.test(row.payment_date));
      if(row.affected_display_amount!==undefined&&row.affected_display_amount!==null){
        requireValue(row.affected_payment_count_complete&&row.affected_payment_count===1);table.formatAmount(row.affected_display_amount);
      }
      if(row.linked_timesheet_id!==undefined&&row.linked_timesheet_id!==null)requireValue(row.affected_payment_count_complete&&row.affected_payment_count===1&&uuid(row.linked_timesheet_id));
    }else{
      requireValue(text(row.candidate_name)&&typeof row.candidate_reference==='string'&&text(row.reason)
        &&uuid(row.candidate_id));
      if(row.affected_display_amount!==null)table.formatAmount(row.affected_display_amount);
      if(row.source_kind!==undefined)requireValue(row.source_kind==='PREVIEW_ROW'?uuid(row.preview_row_id)
        :['STORED_PAYEE','SOURCE_PROGRESS'].includes(row.source_kind)&&row.preview_row_id===null);
    }
    return row;
  }
  function validate(page,summary,kind,cursor=undefined,limit=100,view=undefined){
    requireValue(Object.hasOwn(definitions,kind));table.validateSummary(summary);
    requireValue(object(page)&&page.ok===true&&page.contract===table.CONTRACT&&page.contract_version===1
      &&fields.every(key=>page[key]===summary[key])&&Array.isArray(page.rows)&&page.rows.length<=100
      &&count(page.total_count)&&count(page.scope_count)&&page.total_count<=page.scope_count
      &&page.total_count>=page.rows.length&&(page.rows.length>0||page.total_count===0)
      &&typeof page.has_more==='boolean'&&(page.has_more?token(page.next_cursor)&&page.rows.length>0:page.next_cursor===null)
      &&typeof page.search==='string'&&page.search.length<=200&&!/[\u0000-\u001f\u007f]/u.test(page.search)
      &&definitions[kind].columns.some(([, ,sortKey])=>sortKey===page.sort_key)&&['ASC','DESC'].includes(page.sort_direction));
    requireValue(Number.isInteger(limit)&&limit>=1&&limit<=100&&count(page.page_number)
      &&typeof page.has_previous==='boolean'&&page.has_previous===(page.page_number>1)
      &&(page.page_number>2?token(page.previous_cursor):page.previous_cursor===null)
      &&(page.total_count===0
        ?page.page_number===0&&page.rows.length===0&&!page.has_more&&(cursor===undefined||cursor===null)
        :page.page_number>=1&&page.page_number<=Math.ceil(page.total_count/limit)
          &&(cursor!==null||page.page_number===1)
          &&page.rows.length===Math.min(limit,page.total_count-(page.page_number-1)*limit)
          &&page.has_more===(page.page_number*limit<page.total_count))
      &&(page.search!==''||page.total_count===page.scope_count));
    const isUpdating=kind==='actions'&&page.view==='UPDATING';
    requireValue(page.scope_count===summary.global[kind==='actions'?(isUpdating?'updating_count':'action_required_count'):'blocked_count']);
    if(kind==='actions'){
      requireValue(['ACTION_REQUIRED','UPDATING'].includes(page.view)&&(view===undefined||page.view===view)
        &&count(page.updating_count)&&page.updating_count===summary.global.updating_count
        &&Array.isArray(page.updating)&&page.updating.length===Math.min(100,page.updating_count)
        &&page.updating_has_more===(page.updating_count>100)
        &&(page.updating_has_more?token(page.updating_next_cursor):page.updating_next_cursor===null)
        &&new Set(page.updating.map(row=>row?.identity)).size===page.updating.length);
      page.updating.forEach(row=>{validateRow(row,'actions');requireValue(row.issue_state==='UPDATING');});
      requireValue(page.rows.every(row=>row.issue_state===page.view)
        &&(isUpdating? page.search===''&&page.sort_key==='TITLE'&&page.sort_direction==='ASC'
          &&(cursor!==null||limit!==100||JSON.stringify(page.rows)===JSON.stringify(page.updating))
          :!page.rows.some(row=>page.updating.some(updating=>updating.identity===row.identity))));
    }
    page.rows.forEach(row=>validateRow(row,kind));
    requireValue(new Set(page.rows.map(row=>row.identity)).size===page.rows.length
      &&new TextEncoder().encode(JSON.stringify(page)).byteLength<=256*1024);
    return page;
  }
  function validateDetail(page,summary,kind,identity,cursor=null,limit=100){
    requireValue(Object.hasOwn(definitions,kind));table.validateSummary(summary);
    requireValue(object(page)&&page.ok===true&&page.contract===table.CONTRACT&&page.contract_version===1
      &&fields.every(key=>page[key]===summary[key])&&page[kind==='actions'?'task_key':'blocker_key']===identity
      &&token(identity)&&count(limit)&&limit>=1&&limit<=100&&Array.isArray(page.rows)
      &&count(page.total_count)&&page.total_count>0&&count(page.page_number)&&page.page_number>=1
      &&page.page_number<=Math.ceil(page.total_count/limit)
      &&(cursor!==null||page.page_number===1)
      &&page.rows.length===Math.min(limit,page.total_count-(page.page_number-1)*limit)
      &&page.has_more===(page.page_number*limit<page.total_count)
      &&(page.has_more?token(page.next_cursor):page.next_cursor===null)
      &&page.has_previous===(page.page_number>1)
      &&(page.page_number>2?token(page.previous_cursor):page.previous_cursor===null)
      &&count(page.affected_candidate_count)&&page.affected_candidate_count>0&&validPaymentCount(page));
    requireValue(page.rows.every(row=>object(row)&&token(row.identity)&&uuid(row.candidate_id)
      &&typeof row.context_only==='boolean'&&object(row.payload)&&row.indefinite_snooze!==true
      &&(row.payload.candidate_id==null||row.payload.candidate_id===row.candidate_id)
      &&row.payload.presentation_role!=='HIDDEN_INDEFINITE_SNOOZE'
      &&(row.source_kind==='PREVIEW_ROW'?uuid(row.preview_row_id)&&row.payload.preview_row_id===row.preview_row_id
        :['STORED_PAYEE','SOURCE_PROGRESS'].includes(row.source_kind)&&row.preview_row_id===null))
      &&new Set(page.rows.map(row=>row.identity)).size===page.rows.length
      &&new TextEncoder().encode(JSON.stringify(page)).byteLength<=256*1024);
    return page;
  }
  function rowMarkup(row,kind){
    requireValue(Object.hasOwn(definitions,kind));validateRow(row,kind);
    const key=escape(row.identity);
    if(kind==='actions'){
      const candidate=row.affected_candidate_count===1&&text(row.candidate_name)
        ?escape(row.candidate_name)
        :`${row.affected_candidate_count} ${row.affected_candidate_count===1?'candidate':'candidates'}`;
      const candidateReference=row.affected_candidate_count===1&&typeof row.candidate_reference==='string'&&row.candidate_reference.trim()
        ?`<span>${escape(row.candidate_reference)}</span>`:'';
      const paymentDate=displayDate(row.payment_date);
      const payment=row.affected_payment_count_complete
        ?(row.affected_payment_count===1&&text(row.payment_label)
          ?`${escape(row.payment_label)}${paymentDate?` <span>${paymentDate}</span>`:''}`
          :`${row.affected_payment_count} ${row.affected_payment_count===1?'payment':'payments'}`)
        :'Payment count being checked';
      const amount=row.affected_display_amount===undefined||row.affected_display_amount===null
        ?'—':table.formatAmount(row.affected_display_amount);
      const timesheet=uuid(row.linked_timesheet_id)?`<button type="button" class="bpv2-timesheet-icon banking-timesheet-shortcut" data-bpv2-issue-timesheet="${escape(row.linked_timesheet_id)}" title="Open this Timesheet" aria-label="Open this Timesheet"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm3 8h3v3H8v-3Z"/></svg></button>`:'';
      return `<tr data-bpv2-issue-row="${key}"><td class="bpv2-issue-name"><button type="button" data-bpv2-open="${key}" title="${candidate}">${candidate}</button>${candidateReference}</td>
        <td class="bpv2-issue-payment"${row.affected_payment_count_complete?'':' title="Payment count not yet confirmed."'}>${payment}</td>
        <td class="bpv2-issue-reason" title="${escape(row.title)}">${escape(row.title)}</td><td class="bpv2-issue-number"><span>${amount}</span>${timesheet}</td></tr>`;
    }
    return `<tr data-bpv2-issue-row="${key}"><td class="bpv2-issue-name"><button type="button" data-bpv2-open="${key}" title="${escape(row.candidate_name)}">${escape(row.candidate_name)}</button><span>${escape(row.candidate_reference)}</span></td>
      <td class="bpv2-issue-reason" title="${escape(row.reason)}">${escape(row.reason)}</td><td class="bpv2-issue-number">${row.affected_display_amount===null?'—':table.formatAmount(row.affected_display_amount)}</td></tr>`;
  }
  function create({document,kind,onIntent,onOpenDetail,onOpenUpdating,onViewTimesheets,onClose,onFailure}){
    requireValue(Object.hasOwn(definitions,kind));
    for(const callback of [onIntent,onOpenDetail,onOpenUpdating,onViewTimesheets,onClose,onFailure])if(typeof callback!=='function')throw new TypeError('Issue-list adapters required');
    const definition=definitions[kind];const element=document.createElement('section');
    element.className=`banking-pay-v2-issues bpv2-${kind}`;element.setAttribute('aria-label',definition.title);
    element.innerHTML=`<h2 class="bpv2-visually-hidden">${definition.title}</h2>
      <p class="bpv2-issue-intro">${kind==='actions'?'Payments that need a decision before they can be included.':'Payments that cannot currently be included in a Draft. Indefinite snoozes remain in Loans / Snoozes.'}</p>
      <div class="bpv2-issue-toolbar"><form role="search"><label><span class="bpv2-visually-hidden">Search ${definition.title}</span><input type="search" maxlength="200" autocomplete="off" data-bpv2-issue-search placeholder="Search ${definition.title}"></label><button type="submit" class="btn btn-outline">Search</button></form>
        <button type="button" class="btn btn-outline" data-bpv2-issue-command="updating" hidden></button></div>
      <p role="status" class="bpv2-issue-status" aria-live="polite" hidden></p>
      <div class="bpv2-issue-scroll"><table><thead><tr>${definition.columns.map(([key,label,sortKey])=>`<th scope="col" data-bpv2-issue-header="${sortKey||key}">${sortKey?`<button type="button" data-bpv2-issue-sort="${sortKey}">${label}</button>`:`<span>${label}</span>`}</th>`).join('')}</tr></thead><tbody></tbody></table></div>
      <p data-bpv2-issue-empty hidden></p><footer><span data-bpv2-issue-count></span><button type="button" class="btn btn-outline" data-bpv2-issue-command="previous">Previous</button><button type="button" class="btn btn-outline" data-bpv2-issue-command="next">Next</button></footer>`;
    const body=element.querySelector('tbody'),search=element.querySelector('input'),status=element.querySelector('[role="status"]');
    const scroll=element.querySelector('.bpv2-issue-scroll');let accepted=null,busy=false,closed=false,hasPrevious=false;
    function report(error){if(closed)return;status.textContent='This list could not be updated. Try again.';status.hidden=false;
      onFailure({code:typeof error?.code==='string'?error.code:'BANKING_PAY_V2_UPDATE_FAILED'});}
    function invoke(callback,value){try{Promise.resolve(callback(value)).catch(report);}catch(error){report(error);}}
    const authority=()=>Object.fromEntries(fields.map(key=>[key,accepted[key]]));
    function controls(){for(const control of element.querySelectorAll('button,input')){
      if(control.dataset.bpv2IssueCommand==='close')continue;
      control.disabled=busy||!accepted;
      if(control.dataset.bpv2IssueSort&&accepted?.view==='UPDATING')control.disabled=true;
    }
      // Recompute from accepted navigation after replacing row DOM. A remembered
      // set of disabled elements loses persistent header inputs during adoption.
      element.querySelector('[data-bpv2-issue-command="previous"]').disabled=busy||!accepted||!hasPrevious;
      element.querySelector('[data-bpv2-issue-command="next"]').disabled=busy||!accepted||!accepted.has_more;
      element.setAttribute('aria-busy',String(busy));
    }
    function event(event){
      const control=event.target?.closest?.('button');if(!control||!element.contains(control))return;
      event.stopPropagation();const command=control.dataset.bpv2IssueCommand;
      if(command==='close'){invoke(onClose);return;}
      if(closed||busy||control.disabled||!accepted||event.detail>1)return;
      if(command==='updating'){invoke(onOpenUpdating,{authority:authority()});return;}
      if(command){invoke(onIntent,{kind,command,...(kind==='actions'?{view:accepted.view}:{}),authority:authority()});return;}
      if(control.dataset.bpv2IssueTimesheet){invoke(onViewTimesheets,[control.dataset.bpv2IssueTimesheet]);return;}
      if(control.dataset.bpv2Open){invoke(onOpenDetail,{kind,key:control.dataset.bpv2Open,authority:authority()});return;}
      const sort=control.dataset.bpv2IssueSort;
      if(sort)invoke(onIntent,{kind,command:'sort',sort_key:sort,sort_direction:accepted.sort_key===sort&&accepted.sort_direction==='ASC'?'DESC':'ASC',authority:authority()});
    }
    function doubleClick(event){
      if(event.target?.closest?.('button,input,label,a,select,textarea,[contenteditable="true"]'))return;
      if(closed||busy||!accepted)return;
      const row=event.target?.closest?.('[data-bpv2-issue-row]');const key=row?.dataset?.bpv2IssueRow;
      if(key){event.preventDefault();event.stopPropagation();invoke(onOpenDetail,{kind,key,authority:authority()});}
    }
    function submit(event){event.preventDefault();event.stopPropagation();if(closed||busy||!accepted||accepted.view==='UPDATING')return;
      const value=search.value.trim();if(value.length>200||/[\u0000-\u001f\u007f]/u.test(value)){report({code:'BANKING_PAY_V2_INVALID_INPUT'});return;}
      invoke(onIntent,{kind,command:'search',search:value,authority:authority()});
    }
    element.addEventListener('click',event);element.addEventListener('dblclick',doubleClick);element.querySelector('form').addEventListener('submit',submit);
    return Object.freeze({element,
      prepare(page,summary,{previousAvailable=page.has_previous,filtered=false,returnToActions=false}={}){
        if(closed)throw new Error('Banking issue list is closed');validate(page,summary,kind);
        const staged=document.createElement('tbody');staged.innerHTML=page.rows.map(row=>rowMarkup(row,kind)).join('');
        return ()=>{
          if(closed)return;const top=scroll.scrollTop,left=scroll.scrollLeft,focus=document.activeElement?.dataset?.bpv2Open;
          body.replaceChildren(...Array.from(staged.childNodes));accepted=page;hasPrevious=previousAvailable;
          const isUpdating=kind==='actions'&&page.view==='UPDATING';
          element.querySelector('h2').textContent=isUpdating?'Updating':definition.title;
          element.setAttribute('aria-label',isUpdating?'Updating':definition.title);
          element.querySelector('form').hidden=isUpdating;
          const closeControl=element.querySelector('[data-bpv2-issue-command="close"]');if(closeControl)closeControl.textContent=isUpdating&&returnToActions?'Back to Action Required':'Back to Banking Pay';
          if(kind==='actions')element.querySelector('[data-bpv2-issue-sort="TITLE"]').textContent=isUpdating?'Updating':'Action Required';
          search.value=page.search;
          for(const th of element.querySelectorAll('[data-bpv2-issue-header]'))th.setAttribute('aria-sort',th.dataset.bpv2IssueHeader===page.sort_key?(page.sort_direction==='ASC'?'ascending':'descending'):'none');
          const updating=element.querySelector('[data-bpv2-issue-command="updating"]');
          updating.hidden=kind!=='actions'||isUpdating||page.updating_count===0;updating.textContent=`Updating ${page.updating_count??0}`;
          const empty=element.querySelector('[data-bpv2-issue-empty]');empty.hidden=page.rows.length!==0;
          empty.textContent=isUpdating?'0 tasks':page.search?`0 matching ${definition.noun}`:copy.message(filtered?(kind==='actions'?'MSG-002':'MSG-016'):definition.empty);
          element.querySelector('[data-bpv2-issue-count]').textContent=page.search?`${page.total_count} matching ${definition.noun} · ${page.scope_count} in this Banking Pay list`:`${page.scope_count} ${definition.noun}`;
          status.textContent='';status.hidden=true;controls();scroll.scrollTop=top;scroll.scrollLeft=left;
          if(focus)Array.from(body.querySelectorAll('[data-bpv2-open]')).find(node=>node.dataset.bpv2Open===focus)?.focus({preventScroll:true});
        };
      },
      setBusy(value){if(!closed){busy=Boolean(value);controls();}},
      showFailure(message){if(!closed){status.textContent=String(message);status.hidden=false;}},
      capturePosition:()=>({top:scroll.scrollTop,left:scroll.scrollLeft}),
      destroy(){closed=true;accepted=null;element.removeEventListener('click',event);element.removeEventListener('dblclick',doubleClick);element.querySelector('form').removeEventListener('submit',submit);element.remove();}
    });
  }
  const api=Object.freeze({definitions,validate,validateDetail,rowMarkup,create});
  if(local)module.exports=api;else root.CloudTMSBankingPayIssuesV2=api;
})(typeof window==='object'?window:this);
