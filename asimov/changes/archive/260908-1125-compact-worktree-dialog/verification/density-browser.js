// Run with playwright-cli -s=compact-worktree --raw run-code --filename=<this file>.
// Requires the local real-module harness on :43127 with setPreviewModel,
// openPreview and setPreviewDefaults; host replies are simulated, not VS Code.
async page => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const results = [];
  const geometry = async label => {
    const g = await page.evaluate(() => {
      const root = document.querySelector('.wt-create-dialog');
      const body = document.querySelector('.wt-create-body');
      const footer = document.querySelector('.wt-dialog-actions');
      const r=root.getBoundingClientRect(), b=body.getBoundingClientRect(), f=footer.getBoundingClientRect();
      return {root:[r.x,r.y,r.right,r.bottom],bodyBottom:b.bottom,footerTop:f.top,
        width:innerWidth,height:innerHeight,overflow:root.scrollWidth-root.clientWidth,
        bodyOverflow:body.scrollWidth-body.clientWidth,bodyHeight:b.height};
    });
    assert(g.root[0]>=0 && g.root[1]>=0 && g.root[2]<=g.width+1 && g.root[3]<=g.height+1, `${label}: dialog out of viewport ${JSON.stringify(g)}`);
    assert(g.bodyBottom<=g.footerTop+1 && g.bodyHeight>0, `${label}: footer covers body ${JSON.stringify(g)}`);
    assert(g.overflow<=1 && g.bodyOverflow<=1, `${label}: horizontal overflow ${JSON.stringify(g)}`);
  };
  const tabThrough = async (label, count=45) => {
    await page.locator('#wt-branch').focus();
    for(let i=0;i<count;i++) {
      await page.keyboard.press('Tab');
      const bad = await page.evaluate(() => {
        const e=document.activeElement;
        if(!e.closest('.wt-create-body')) return null;
        const r=e.getBoundingClientRect(),b=document.querySelector('.wt-create-body').getBoundingClientRect();
        return r.top<b.top-1 || r.bottom>b.bottom+1 ? {id:e.id,cls:e.className,top:r.top,bottom:r.bottom,bodyTop:b.top,bodyBottom:b.bottom}:null;
      });
      assert(!bad,`${label}: keyboard focus clipped ${JSON.stringify(bad)}`);
    }
  };
  for(const [width,height] of [[390,360],[560,360],[1024,360],[390,900],[560,1200],[1440,900],[500,350],[320,240]]) {
    await page.setViewportSize({width,height});
    for(const route of ['', '?sparse', '?files']) {
      await page.goto('http://127.0.0.1:43127/'+route);
      await geometry(`${width}x${height}${route}`);
      await tabThrough(`${width}x${height}${route}`);
    }
    results.push(`${width}x${height}: normal/sparse/files, geometry and real Tab traversal PASS`);
  }
  await page.setViewportSize({width:560,height:360});
  await page.goto('http://127.0.0.1:43127/');
  await page.evaluate(() => {
    const entries=Array.from({length:140},(_,i)=>({id:`c${i}`,mode:'copy',path:`files/${i}`,source:'orca.yaml'}));
    const links=Array.from({length:20},(_,i)=>({id:`l${i}`,mode:'link',path:`shared/${i}`,source:'orca.yaml'}));
    const setup=Array.from({length:39},(_,i)=>({id:`s${i}`,kind:'shell',script:`echo step-${i}`,source:'orca.yaml'}));
    window.setPreviewModel({entries:[...entries,...links,{id:'env',mode:'copy',path:'.env',source:'.env',suggestion:'May contain secrets.'}],setup,ports:[],providers:[],problems:[],contenders:[],excluded:[]});
    window.openPreview();
  });
  assert(await page.locator('.wt-files-body .wt-brow').count()===1,'one suggestion opened routine files');
  assert(!await page.locator('.wt-files-routine-body').isVisible(),'routine files expanded');
  assert(await page.locator('.wt-files-routine-body input:checked').count()===140,'routine selection lost');
  assert(await page.locator('.wt-setup-group input:checked').count()===0,'provider command auto-selected');
  assert((await page.locator('.wt-files-shared').textContent())==='20 shared folders — writes to main','link aggregate wrong');
  const height=await page.locator('.wt-files-shared').evaluate(e=>e.getBoundingClientRect().height);
  assert(height<40,'unbounded link summary');
  await tabThrough('200-row offer',90);
  await page.locator('.wt-files-links-toggle').click();
  assert(await page.locator('.wt-files-links-body .wt-brow').count()===20,'shared details missing');
  assert(!await page.locator('.wt-files-routine-body').isVisible(),'shared View expanded copies');
  await page.locator('.wt-files-links-body input').first().uncheck();
  assert((await page.locator('.wt-files-shared').textContent()).startsWith('19 shared'),'aggregate did not update');
  await page.locator('.wt-files-links-toggle').click();
  await page.locator('.wt-setup-group input').first().check();
  assert((await page.locator('.wt-setup-count').textContent())==='39 configured · 1 selected','setup counts wrong');
  await page.locator('.wt-prompt-toggle').click();
  await page.locator('.wt-textarea').fill('First prompt\n'.repeat(60));
  await page.locator('#wt-advanced-toggle').click();
  await geometry('dense expanded');
  await tabThrough('dense expanded',100);
  await page.locator('#wt-branch').fill('feat/density');
  await page.locator('.wt-create-body').evaluate(e=>{e.scrollTop=0;});
  await page.screenshot({path:'/tmp/compact-worktree-preview/density-short.png'});
  results.push(`200-row offer: 140 routine copies collapsed, 1 review row, 20 links summarized in ${height}px, 39 commands unchecked; expanded focus PASS`);

  // Give the footer a multi-line status to exercise its dynamic geometry.
  await page.evaluate(() => {const e=document.querySelector('.wt-create-disabled-reason');e.hidden=false;e.textContent='Waiting for the selected repository to answer about this destination before creation can continue. '.repeat(3);});
  await geometry('wrapped footer');
  await tabThrough('wrapped footer',100);
  results.push('Wrapped action feedback and keyboard visibility PASS (injected layout fixture)');

  for(const state of ['no-offer','empty','no-agents','dangerous']) {
    await page.goto('http://127.0.0.1:43127/?sparse');
    await page.evaluate(state => {
      if(state==='no-offer') window.setPreviewDefaults({provisioning:undefined});
      if(state==='empty') {window.setPreviewModel({entries:[],setup:[],ports:[],providers:[]});window.openPreview();}
      if(state==='no-agents') window.setPreviewDefaults({agents:[]});
      if(state==='dangerous') window.setPreviewDefaults({agents:[{id:'unsafe',label:'Unsafe Agent',canSeedPrompt:true,permissionChoices:[{id:'danger',label:'Full access',dangerous:true}]}]});
    },state);
    await geometry(state); await tabThrough(state);
    if(state==='no-offer') assert(!await page.locator('.wt-bring').isVisible(),'no offer claims an environment');
    if(state==='empty') assert((await page.locator('.wt-files-count').textContent())==='No extra files','empty state wrong');
    if(state==='no-agents') assert(await page.locator('#wt-after option[value="agent"]').count()===0,'unavailable agent offered');
    if(state==='dangerous') {
      assert(await page.locator('#wt-after').inputValue()==='terminal','dangerous initial default');
      await page.locator('#wt-after').selectOption('agent');
      assert(await page.locator('.wt-agent-permission-warning').isHidden(),'dangerous permission preselected');
    }
    results.push(`${state}: initial rendering, safe defaults and Tab traversal PASS`);
  }
  await page.goto('http://127.0.0.1:43127/?sparse');
  await page.locator('.wt-bring-add-setup').click();
  assert(await page.locator('.wt-bring-add-copy').isDisabled(),'busy ask permits competing copy');
  assert(await page.locator('.wt-btn--primary').isDisabled(),'busy ask permits create');
  await geometry('busy'); await tabThrough('busy');
  results.push('Pending host input: disabled competing controls and focus PASS');

  await page.goto('http://127.0.0.1:43127/?files');
  await page.setViewportSize({width:390,height:900});
  await page.evaluate(() => {window.setPreviewModel({entries:[{id:'long',mode:'copy',path:'long-folder/'.repeat(40)+'.env',source:'long-folder/'.repeat(40)+'.env',suggestion:'May contain secrets.'}],setup:[{id:'script',kind:'shell',source:'orca.yaml',script:'echo '+ 'long-command-argument-'.repeat(60)}]});window.openPreview();});
  await geometry('long content');
  assert((await page.locator('.wt-files-body .wt-brow').boundingBox()).height<=28,'file row grew');
  const text = await page.locator('.wt-files-body code').evaluate(e=>({title:e.title,text:e.textContent}));
  assert(text.title===text.text,'truncated full path inaccessible');
  await page.addStyleTag({content:':root {color-scheme:light;--vscode-foreground:#292929;--vscode-descriptionForeground:#616161;--vscode-editor-background:#fff;--vscode-editorWidget-background:#f8f8f8;--vscode-widget-border:#d6d6d6;--vscode-input-background:#fff;--vscode-input-foreground:#292929;--vscode-input-border:#cecece;--vscode-textLink-foreground:#006ab1;--vscode-editorWarning-foreground:#886500;}'});
  await geometry('light long content');
  results.push('Long paths/full hover, long scripts and light theme PASS');
  await page.goto('http://127.0.0.1:43127/?files');
  await page.setViewportSize({width:560,height:900});
  await page.screenshot({path:'/tmp/compact-worktree-preview/density-files.png'});
  await page.setViewportSize({width:390,height:360});
  await page.evaluate(() => window.setPreviewDefaults({refs:{list:Array.from({length:40},(_,i)=>({name:`feature-${i}`,oid:`oid-${i}`})),truncated:false}}));
  await page.locator('#wt-branch').fill('feature');
  for(let i=0;i<42;i++) {
    await page.keyboard.press('ArrowDown');
    const visible = await page.evaluate(() => {
      const input=document.querySelector('#wt-branch');
      const active=document.getElementById(input.getAttribute('aria-activedescendant'));
      if(!active) return false;
      const r=active.getBoundingClientRect(),b=document.querySelector('.wt-create-body').getBoundingClientRect();
      return r.top>=b.top-1 && r.bottom<=b.bottom+1;
    });
    assert(visible, `branch active descendant clipped at arrow ${i}`);
  }
  results.push('40 branch options: arrow navigation keeps active options inside the scrolling body');
  return results;
}
