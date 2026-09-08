// Real dialog and VaultPanel/CSS via localhost :43127; host callbacks are simulated.
// Routing disables HTTP cache so successive preview rebuilds cannot verify old CSS.
async page => {
  await page.route('http://127.0.0.1:43127/**', route=>route.continue());
  const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
  const results=[];
  await page.goto('http://127.0.0.1:43127/?fresh=independent-scroll');
  await page.setViewportSize({width:1100,height:320});
  await page.evaluate(()=>{
    window.setPreviewModel({entries:Array.from({length:150},(_,i)=>({id:`env${i}`,mode:'copy',path:`dir/${i}/.env`,source:'orca.yaml',suggestion:'May contain secrets.'})),setup:Array.from({length:50},(_,i)=>({id:`s${i}`,kind:'shell',script:`echo step-${i}`,source:'orca.yaml'})),ports:[],providers:[]});
    window.openPreview();
  });
  const rightBefore=await page.locator('.wt-create-secondary').boundingBox();
  const primary=await page.locator('.wt-create-primary').boundingBox();
  await page.mouse.move(primary.x+primary.width/2,primary.y+60);
  await page.mouse.wheel(0,600);
  await page.waitForFunction(()=>document.querySelector('.wt-create-primary').scrollTop>0);
  const scrolled=await page.evaluate(()=>({left:document.querySelector('.wt-create-primary').scrollTop,body:document.querySelector('.wt-create-body').scrollTop,right:document.querySelector('.wt-create-secondary').scrollTop}));
  const rightAfter=await page.locator('.wt-create-secondary').boundingBox();
  assert(scrolled.left>0&&scrolled.body===0&&scrolled.right===0&&rightAfter.y===rightBefore.y,'left wheel moved launch controls: '+JSON.stringify(scrolled));
  await page.locator('.wt-prompt-toggle').click();
  await page.locator('.wt-textarea').fill('Keep this prompt while scrolling setup');
  await page.locator('#wt-advanced-toggle').click();
  const secondary=await page.locator('.wt-create-secondary').evaluate(e=>({height:e.clientHeight,scrollHeight:e.scrollHeight,overflow:getComputedStyle(e).overflowY}));
  assert(secondary.scrollHeight>secondary.height&&secondary.overflow==='auto','expanded secondary content not independently reachable');
  await page.locator('#wt-advanced-body input').last().focus();
  const leftAfter=await page.locator('.wt-create-primary').evaluate(e=>e.scrollTop);
  assert(leftAfter===scrolled.left,'focusing advanced scrolled preparation');
  await page.locator('.wt-create-secondary').evaluate(e=>{e.scrollTop=0;});
  await page.screenshot({path:'/tmp/compact-worktree-preview/independent-scroll.png'});
  results.push('200-row offer: real wheel scrolls only preparation; launch column stays fixed; oversized Advanced scrolls separately');
  await page.locator('#wt-branch').focus();
  for(let i=0;i<220;i++){
    await page.keyboard.press('Tab');
    const bad=await page.evaluate(()=>{
      const e=document.activeElement,body=document.querySelector('.wt-create-body');
      if(!body.contains(e))return null;
      const col=e.closest('.wt-create-primary,.wt-create-secondary');
      const clip=(col&&getComputedStyle(col).overflowY==='auto'?col:body).getBoundingClientRect();
      const r=e.getBoundingClientRect();
      return r.top<clip.top-1||r.bottom>clip.bottom+1?{id:e.id,top:r.top,bottom:r.bottom,clip:[clip.top,clip.bottom]}:null;
    });
    assert(!bad,'focused control clipped by its column '+JSON.stringify(bad));
  }
  results.push('220 real Tab moves through both independently scrolling columns keep focus visible');

  for(const [width,height] of [[1100,900],[1100,320],[390,350]]){
    await page.setViewportSize({width,height});
    assert(await page.locator('.wt-create-panel-size').isVisible(),'panel-height control disappeared after resize');
    assert(await page.locator('.wt-create-panel-size').getAttribute('aria-label')==='Toggle panel height','state-guessing label retained');
    assert(await page.locator('.wt-textarea').inputValue()==='Keep this prompt while scrolling setup','draft lost');
  }
  assert(await page.evaluate(()=>window.panelSizeRequests??0)===0,'resize called native toggle');
  await page.locator('.wt-create-panel-size').click();
  assert(await page.evaluate(()=>window.panelSizeRequests)===1,'explicit toggle not dispatched');
  const single=await page.locator('.wt-create-body').evaluate(e=>({overflow:getComputedStyle(e).overflowY,scroll:e.scrollHeight,height:e.clientHeight}));
  assert(single.overflow==='auto'&&single.scroll>single.height,'stacked mode lost its single body scroll');
  results.push('Neutral panel-height toggle remains reachable in tall/full-surface/stacked layouts without auto-dispatch; one-column scroll retained');

  await page.goto('http://127.0.0.1:43127/?vault&fresh=ultra-matrix');
  await page.setViewportSize({width:1100,height:700});
  await page.addStyleTag({content:':root{--vscode-list-hoverBackground:#2a2d2e;} #app{display:flex;flex-direction:column;height:300px;} #vault-preview{height:auto!important;width:100%!important;}'});
  for(const width of [80,100,120,140,150,180,210,280,400]){
    await page.locator('#app').evaluate((e,width)=>{e.style.width=`${width}px`;},width);
    for(const view of ['worktree','sessions']){
      for(const collapsed of [false,true]){
        await page.evaluate(({view,collapsed})=>{window.vaultPreview.setView(view,{persist:false});window.vaultPreview.setCollapsed(collapsed,{persist:false});},{view,collapsed});
        const g=await page.locator('.vault-header').evaluate(e=>{
          const r=e.getBoundingClientRect(),h=e.parentElement.getBoundingClientRect();
          const buttons=[...e.querySelectorAll('button')].filter(b=>!b.closest('[hidden]'));
          return {header:{left:r.left,right:r.right,bottom:r.bottom,height:r.height},hostBottom:h.bottom,buttons:buttons.map(b=>{
            const r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
            return {label:b.getAttribute('aria-label'),left:r.left,right:r.right,top:r.top,bottom:r.bottom,hit:hit?.closest('button')===b};
          })};
        });
        assert(g.header.bottom<=g.hostBottom+1,`header clipped ${width}/${view}/${collapsed}: ${JSON.stringify(g)}`);
        for(let i=0;i<g.buttons.length;i++){
          const b=g.buttons[i];
          assert(b.hit&&b.label&&b.left>=g.header.left-1&&b.right<=g.header.right+1&&b.bottom<=g.header.bottom+1,`unreachable button ${width}/${view}/${collapsed}: ${JSON.stringify(b)}`);
          for(let j=i+1;j<g.buttons.length;j++){
            const c=g.buttons[j];
            assert(b.right<=c.left+0.1||c.right<=b.left+0.1||b.bottom<=c.top+0.1||c.bottom<=b.top+0.1,`overlap ${width}: ${JSON.stringify([b,c])}`);
          }
        }
        if(view==='worktree'&&!collapsed){
          const rows=await page.locator('.wt-row').evaluateAll(rows=>rows.map(e=>{
            const r=e.getBoundingClientRect(),branch=e.querySelector('.wt-branch').getBoundingClientRect();
            return {branchWidth:branch.width,left:r.left,right:r.right,marks:[...e.querySelectorAll('.wt-pill,.wt-badge,.wt-rowaction')].map(m=>{const b=m.getBoundingClientRect();return {text:m.textContent,left:b.left,right:b.right};})};
          }));
          assert(rows.length===6,'real tree-row fixture missing');
          for(const row of rows){
            assert(row.branchWidth>=20,`branch erased at ${width}: ${JSON.stringify(row)}`);
            assert(row.marks.every(m=>m.left>=row.left&&m.right<=row.right),`status/action clipped at ${width}: ${JSON.stringify(row)}`);
          }
        }
        if(width<=140)assert(g.header.height>24,'ultra-narrow actions did not wrap');
        if(collapsed)assert(g.hostBottom-g.header.bottom<2,'collapsed shell retained empty body height');
      }
    }
    await page.locator('[data-view="worktree"]').click();
    await page.locator('.vault-header button[aria-label="Search worktrees"]').click();
    assert(await page.locator('.vault-search-input').isVisible(),'search inaccessible at '+width);
    await page.locator('.vault-search-input').press('Escape');
    await page.locator('.vault-header button[aria-label="Create worktree"]').click();
    assert(await page.locator('.wt-create-dialog').isVisible(),'create inaccessible at '+width);
    await page.locator('.wt-dialog-title .wt-dismiss').click();
    results.push(`${width}px header: both bodies, expanded/collapsed fit, non-overlapping center hit targets, real Search/Create clicks PASS`);
  }
  await page.locator('#app').evaluate(e=>{e.style.width='100px';});
  await page.evaluate(()=>window.vaultPreview.setCollapsed(true,{persist:false}));
  await page.locator('.vault-header').screenshot({path:'/tmp/compact-worktree-preview/vault-ultranarrow-100.png'});
  await page.locator('#app').evaluate(e=>{e.style.width='80px';});
  await page.locator('.vault-header').screenshot({path:'/tmp/compact-worktree-preview/vault-ultranarrow-80.png'});
  await page.evaluate(()=>window.vaultPreview.setCollapsed(false,{persist:false}));
  await page.locator('#app').evaluate(e=>{e.style.width='100px';e.style.height='500px';});
  await page.locator('#vault-preview').screenshot({path:'/tmp/compact-worktree-preview/vault-ultranarrow-tree.png'});
  results.push('Real tree rows: branches remain at least 20px wide and main/open/locked/missing badges plus row actions fit at every tested width');
  return results;
}
