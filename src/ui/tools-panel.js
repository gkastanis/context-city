import { el, button } from './dom.js';
import { toolReport, filterFailures, stepFailure, failureScope } from './tools.js';
import { formatTokens } from './math.js';
import { agentColor } from './agents.js';

export function createToolsPanel({ navigate, onOpen = () => {}, onClose = () => {}, onFilterChange = () => {} }) {
  let report = null, session = null, tab = 'tools', filters = {}, active = null, sort = 'tool', descending = false;
  const badge = el('span', { class: 'tools-badge', hidden: true });
  const toggle = button('', () => root.hidden ? open() : close(), { id: 'show-tools', 'aria-controls': 'tools-panel', 'aria-expanded': 'false' });
  toggle.append('Tools ',badge);
  const heading = el('h2', { id: 'tools-heading', tabindex: '-1' }, 'Tools');
  const tabs = el('div', { class: 'tools-tabs', role: 'tablist', 'aria-label': 'Tool diagnostics' });
  const health = el('section', { id: 'tools-health', role: 'tabpanel', 'aria-labelledby': 'tools-tab' });
  const failed = el('section', { id: 'tools-failures', role: 'tabpanel', 'aria-labelledby': 'failures-tab', hidden: true });
  const tabButtons = ['tools','failures'].map((value,i) => button(i ? 'Failures' : 'Tools', () => setTab(value), {
    id: `${value}-tab`, role: 'tab', 'aria-controls': i ? 'tools-failures' : 'tools-health', 'aria-selected': String(!i), tabindex: i ? '-1' : '0',
  }));
  tabs.append(...tabButtons);
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); setTab(event.key==='Home'?'tools':event.key==='End'?'failures':tab==='tools'?'failures':'tools'); tabButtons[tab==='tools'?0:1].focus();
  });
  const total = el('p', { class: 'muted tools-summary' });
  const position = el('span', { 'aria-live': 'polite' });
  const previous = button('Previous', () => step(-1), { 'aria-label': 'Previous failure' });
  const next = button('Next', () => step(1), { 'aria-label': 'Next failure' });
  const nav = el('div', { class: 'failure-navigation' }, previous,position,next);
  const chips = el('div', { class: 'tools-filters', 'aria-label': 'Failure filters' });
  const list = el('div', { class: 'tools-failure-list' });
  failed.append(el('div', { class: 'failure-controls' },total,nav,chips),list);
  const root = el('aside', { id: 'tools-panel', class: 'card panel', hidden: true, 'aria-labelledby': 'tools-heading' },
    el('div', { class: 'tools-heading' }, heading, button('Close',()=>close(), { id:'close-tools' })),tabs,health,failed);
  function open(value = tab) { setTab(value); root.hidden=false; toggle.setAttribute('aria-expanded','true'); onOpen(); heading.focus({preventScroll:true}); list.querySelector('[aria-current="true"]')?.scrollIntoView?.({block:'nearest'}); }
  function close(restore = true) { if(root.hidden) return; root.hidden=true; toggle.setAttribute('aria-expanded','false'); const target=onClose() ?? toggle; if(restore) target.focus({preventScroll:true}); }
  function setTab(value) {
    tab=value; health.hidden=value!=='tools'; failed.hidden=value!=='failures';
    tabButtons.forEach((b,i)=>{ b.setAttribute('aria-selected',String((i===0)===(value==='tools'))); b.setAttribute('tabindex',(i===0)===(value==='tools')?'0':'-1'); });
  }
  function filtered() { return filterFailures(report?.failures ?? [],filters); }
  function selectFailure(f, go = true) {
    if(!f) return; active=f; renderFailures();
    list.querySelector('[aria-current="true"]')?.scrollIntoView?.({block:'nearest'});
    if(go) navigate(f);
  }
  function scope(f = active) { return failureScope(filtered(),f,report?.failures ?? []); }
  function step(delta, f = active) { selectFailure(stepFailure(scope(f),f,delta)); }
  function renderChips() {
    chips.replaceChildren();
    const entries = [['server','Server'],['tool','Tool'],['category','Category'],['agentId','Run']];
    for (const [key,label] of entries) {
      if(key==='server' && !report.tools.some(t=>t.server)) continue;
      if(key==='agentId' && !(session.agents?.length)) continue;
      const group=el('div',{class:'filter-group','aria-label':label},el('span',{class:'filter-label'},label));
      const counts=new Map();
      for(const f of report.failures) { const value=f[key] ?? (key==='server'?'Built-in':'main'); const info=counts.get(value)??{n:0,label:key==='agentId'?f.run:key==='tool' && f.server?f.shortName:value}; info.n++; counts.set(value,info); }
      for(const [value,info] of counts) {
        const actual=key==='server' && value==='Built-in'?null:key==='agentId' && value==='main'?null:value;
        // Main/Built-in use a dedicated sentinel in the controls; normalize in filtered().
        const selected=Object.hasOwn(filters,key) && filters[key]===actual;
        const b=button(`${info.label} ${info.n}`,()=>{ if(selected) delete filters[key]; else filters[key]=actual; active=null; renderFailures(); onFilterChange(); [...chips.querySelectorAll('button')].find(n=>n.dataset.filter===key && n.dataset.value===value)?.focus({preventScroll:true}); },{'aria-pressed':String(selected),'data-filter':key,'data-value':value,title:key==='tool'?value:info.label});
        if(key==='agentId') b.style.setProperty('--run-color',agentColor(info.label));
        group.append(b);
      }
      chips.append(group);
    }
    if(Object.keys(filters).length) chips.append(button('Clear filters',()=>{filters={};active=null;renderFailures();onFilterChange();},{class:'clear-filters'}));
  }
  function renderFailures() {
    if(!report) return;
    renderChips(); const items=filtered();
    total.textContent=`${items.length} of ${report.failures.length} failures · ${formatTokens(items.reduce((n,f)=>n+f.errorTokens,0))} tokens of error text`;
    const navigation = scope();
    position.textContent=active && navigation.includes(active) ? `${navigation.indexOf(active)+1} of ${navigation.length}` : `${navigation.length} failures`;
    previous.disabled=next.disabled=!navigation.length;
    list.replaceChildren(...items.map((f,i)=> {
      const row=button('',()=>selectFailure(f),{class:'tool-failure','aria-current':String(f===active),'data-block-id':f.blockId});
      row.append(el('span',{class:'failure-dot','aria-hidden':'true'}),el('span',{class:'failure-row-title'},el('span',{class:'muted'},f.server?f.server+' / ':''),el('strong',{},f.shortName)),
        el('span',{class:'category-chip'},f.category),el('span',{class:'failure-excerpt',title:f.errorText},f.errorText.split('\n').find(s=>s.trim()) || 'Error text unavailable'),
        el('span',{class:'failure-meta'},`Request ${f.requestNumber} · ${f.run} · ${formatTokens(f.tokens)} tokens${f.retried?' · retried':''}`));
      return row;
    }));
    if(!items.length) list.append(el('p',{class:'tools-empty'},report.failures.length?'No failures for this filter.':'No failed tool calls in this session.'));
  }
  const numeric = { calls:t=>t.calls, failures:t=>t.failures, result:t=>t.resultTokens.max??0, latency:t=>t.latency.max??-1, definition:t=>t.definitionTokens };
  const ms = n => n==null?'-':n<1000?`${Math.round(n)} ms`:`${(n/1000).toFixed(1)} s`;
  const pair = (d,format) => `${d.median==null?'-':format(d.median)} / ${d.max==null?'-':format(d.max)}`;
  function renderHealth() {
    health.replaceChildren();
    health.append(el('p',{class:'tools-summary muted'},`${report.tools.filter(t=>t.calls).length} tools called · ${report.calls.length} calls · ${report.failures.length} failures`));
    const table=el('table',{class:'tools-table'},el('caption',{class:'muted'},'Output and latency: median / max. Tokens are estimated. Dash means no recorded timing.'));
    const head=el('tr');
    for(const [key,label] of [['tool','Tool'],['calls','Calls'],['failures','Failed'],['result','Result tokens'],['latency','Latency'],['definition','Definition tokens']]) {
      head.append(el('th',{scope:'col','aria-sort':sort===key?descending?'descending':'ascending':'none'},button(label,()=>{descending=sort===key?!descending:key!=='tool';sort=key;renderHealth(); health.querySelector('[aria-sort="'+(descending?'descending':'ascending')+'"] button')?.focus({preventScroll:true});})));
    }
    table.append(el('thead',{},head));
    const groups=[...new Set(report.tools.filter(t=>t.calls || t.failures).map(t=>t.server))].sort((a,b)=>a==null?1:b==null?-1:a.localeCompare(b));
    for(const server of groups) {
      const rows=report.tools.filter(t=>t.server===server && (t.calls || t.failures));
      rows.sort((a,b)=>(sort==='tool'?a.shortName.localeCompare(b.shortName):numeric[sort](a)-numeric[sort](b))*(descending?-1:1));
      const body=el('tbody');
      body.append(el('tr',{class:'tool-server'},el('th',{colspan:'6',scope:'rowgroup'},el('strong',{},server ?? 'Built-in'),el('span',{class:'muted'},` ${rows.reduce((n,t)=>n+t.calls,0)} calls · ${rows.reduce((n,t)=>n+t.failures,0)} failed · ${formatTokens(rows.reduce((n,t)=>n+t.resultTokens.total,0))} output tokens · ${formatTokens(rows.reduce((n,t)=>n+t.definitionTokens,0))} schema tokens`))));
      for(const t of rows) {
        const title=`${t.retries} retries · ${t.identicalInputs} repeated inputs`+(t.runs.length>1?' · '+t.runs.map(r=>`${r.run}: ${r.calls} calls, ${r.failures} failed`).join('; '):'');
        const target=button(t.shortName,()=>{if(t.failures){filters={tool:t.tool};active=null;setTab('failures');renderFailures();onFilterChange();}else if(t.callList[0]) navigate(t.callList[0]);},{class:'tool-name',title});
        const row=el('tr',{class:'tool-health-row',title});
        const details=el('div',{},target);
        if(t.retries || t.identicalInputs) details.append(el('span',{class:'tool-row-note muted'},`${t.retries} retries · ${t.identicalInputs} repeats`));
        if(session.agents?.length) {
          const main=t.runs.find(r=>!r.agentId)?.calls ?? 0, agents=t.runs.filter(r=>r.agentId);
          details.append(el('span',{class:'tool-row-note muted',title:t.runs.map(r=>`${r.run}: ${r.calls} calls / ${r.failures} failed`).join('; ')},`Main ${main}`+(agents.length?` · ${agents.length} subagents ${agents.reduce((n,r)=>n+r.calls,0)}`:'')));
        }
        const cells=[details,String(t.calls),`${t.failures} (${Math.round(t.failureRate*100)}%)`,pair(t.resultTokens,formatTokens),pair(t.latency,ms),el('span',{},formatTokens(t.definitionTokens),el('span',{class:'tool-row-note muted'},`${t.definitionRequests} requests`))];
        ['Tool','Calls','Failed','Result tokens · median / max','Latency · median / max','Definition tokens'].forEach((label,i)=>row.append(el('td',{'data-label':label,class:i===2&&t.failures?'has-failures':''},cells[i])));
        row.addEventListener('click',e=>{if(e.target.closest('button'))return;target.click();}); body.append(row);
      }
      table.append(body);
    }
    health.append(table);
    if(!groups.length) health.append(el('p',{class:'tools-empty'},'No tool calls in this session.'));
    health.append(el('details',{class:'unused-tools'},el('summary',{},`Unused tools: ${report.unused.length}, ${formatTokens(report.unusedTokens)} tokens of definitions carried on every request where present`),
      el('p',{class:'muted'},`${formatTokens(report.unusedCost)} total tokens carried across requests. Definitions may change during a session.`),
      ...report.unused.map(t=>el('p',{},`${t.tool} · ${formatTokens(t.definitionTokens)} tokens · ${t.definitionRequests} requests`))));
  }
  // Registered on document so navigation continues when the Reader holds focus.
  document.addEventListener('keydown',event=>{
    if(root.hidden || tab!=='failures' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const owner = event.target.closest?.('.panel, [role="dialog"], [aria-modal="true"]');
    if(document.querySelector('dialog[open]') || (owner && owner !== root && owner.id !== 'reader-panel')) return;
    if(event.target.closest?.('#reader-panel') && ['ArrowUp','ArrowDown'].includes(event.key)) return;
    const delta=['ArrowDown','j'].includes(event.key)?1:['ArrowUp','k'].includes(event.key)?-1:0;
    if(delta){event.preventDefault();step(delta);} else if(event.key==='Enter' && !event.target.closest?.('button, a, summary') && active){event.preventDefault();navigate(active);}
  });
  return {root,toggle,open,close,step, get active(){return active;}, get items(){return filtered();}, scope,
    setSession(value){if(value===session)return;session=value;report=toolReport(value);filters={};active=null;tab='tools';close(false);badge.textContent=String(report.failures.length);badge.hidden=!report.failures.length;renderHealth();renderFailures();setTab('tools');},
    showFailure(f,go=true){filters={};setTab('failures');open('failures');selectFailure(report.failures.find(x=>x.blockId===f.blockId&&x.agentId===f.agentId)??report.failures[0],go);},
    sync(blockId,agentId){const f=report?.failures.find(f=>f.agentId===agentId&&f.resultBlockIds.includes(blockId));if(f && f!==active){active=f;renderFailures();list.querySelector('[aria-current="true"]')?.scrollIntoView?.({block:'nearest'});}},
  };
}
