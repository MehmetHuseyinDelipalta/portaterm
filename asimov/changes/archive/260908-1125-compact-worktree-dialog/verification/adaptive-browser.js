// playwright-cli -s=compact-worktree --raw run-code --filename=<this file>
// Real create form + VaultPanel/CSS; localhost :43127 harness simulates host replies.
async page => {
  const results=[];
  const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
  const geometry=async(width,height)=>{
    const g=await page.evaluate(()=>{
      const root=document.querySelector('.wt-create-dialog'), body=document.querySelector('.wt-create-body');
      const r=root.getBoundingClientRect(),b=body.getBoundingClientRect(),f=document.querySelector('.wt-dialog-actions').getBoundingClientRect();
      const p=document.querySelector('.wt-create-primary').getBoundingClientRect(),s=document.querySelector('.wt-create-secondary').getBoundingClientRect();
      return {x:r.x,y:r.y,width:r.width,height:r.height,footer:f.bottom,footerTop:f.top,bodyBottom:b.bottom,overflow:body.scrollWidth-body.clientWidth,rootOverflow:root.scrollWidth-root.clientWidth,primaryRight:p.right,primaryTop:p.top,secondaryLeft:s.left,secondaryTop:s.top,scrim:getComputedStyle(document.querySelector('.wt-scrim')).display};
    });
    assert(g.overflow<=1&&g.rootOverflow<=1,`overflow ${width}x${height}: ${JSON.stringify(g)}`);
    assert(g.bodyBottom<=g.footerTop+1&&g.footer<=height+1,`footer overlap ${JSON.stringify(g)}`);
    if(height<=560){
      assert(g.x===0&&g.y===0&&g.width===width&&g.height===height,`not full-surface ${JSON.stringify(g)}`);
      assert(Math.abs(g.footer-height)<1,'footer does not reach bottom');
      assert(g.scrim==='none','low form still has scrim');
      if(width>=760)assert(g.primaryRight<g.secondaryLeft&&Math.abs(g.primaryTop-g.secondaryTop)<1,'wide form not side by side');
      else assert(g.secondaryTop>g.primaryTop,'narrow form not stacked');
    }else assert(g.width<=560&&g.x>0&&g.y>0&&g.scrim!=='none','tall form lost compact modal');
  };
  const tabCheck=async(label,count=40)=>{
    await page.locator('#wt-branch').focus();
    for(let i=0;i<count;i++){
      await page.keyboard.press('Tab');
      const bad=await page.evaluate(()=>{
        const e=document.activeElement;if(!e.closest('.wt-create-body'))return null;
        const r=e.getBoundingClientRect(),b=document.querySelector('.wt-create-body').getBoundingClientRect();
        return r.top<b.top-1||r.bottom>b.bottom+1?{id:e.id,cls:e.className,top:r.top,bottom:r.bottom,body:[b.top,b.bottom]}:null;
      });
      assert(!bad,`${label} focus clipped ${JSON.stringify(bad)}`);
    }
  };
  for(const [width,height] of [[1100,320],[850,300],[760,560],[759,560],[1100,561],[390,350],[320,240],[1024,900]]){
    await page.setViewportSize({width,height});
    for(const route of ['', '?sparse','?files']){
      await page.goto('http://127.0.0.1:43127/'+route);
      await geometry(width,height); await tabCheck(`${width}x${height}${route}`);
    }
    results.push(`${width}x${height}: full-surface/modal breakpoint, column layout, no overflow and Tab traversal PASS`);
  }
  await page.goto('http://127.0.0.1:43127/');
  await page.setViewportSize({width:1100,height:320});
  await page.locator('#wt-branch').fill('feat/resize-retains-draft');
  await page.locator('.wt-setup-declared input').first().check();
  await page.locator('.wt-prompt-toggle').click();
  await page.locator('.wt-textarea').fill('Keep this prompt after resizing');
  await page.locator('#wt-advanced-toggle').click();
  await page.locator('.wt-textarea').focus();
  await page.evaluate(()=>window.savedFormNodes=[document.querySelector('#wt-branch'),document.querySelector('.wt-textarea'),document.querySelector('.wt-setup-declared input')]);
  for(const [width,height] of [[1024,900],[390,350],[1100,320]]){
    await page.setViewportSize({width,height});
    assert(await page.evaluate(()=>window.savedFormNodes[0]===document.querySelector('#wt-branch')&&window.savedFormNodes[1]===document.activeElement&&window.savedFormNodes[2].checked),'resize rebuilt nodes or lost focus/ticks');
    assert(await page.locator('.wt-textarea').inputValue()==='Keep this prompt after resizing','prompt lost');
    assert(await page.locator('#wt-branch').inputValue()==='feat/resize-retains-draft','branch lost');
    assert(await page.locator('#wt-advanced-body').isVisible(),'disclosure lost');
  }
  assert(await page.evaluate(()=>window.panelSizeRequests??0)===0,'resizing auto-dispatched panel action');
  await page.locator('.wt-create-panel-size').click();
  assert(await page.evaluate(()=>window.panelSizeRequests)===1,'explicit panel action missing');
  assert(await page.locator('#wt-branch').inputValue()==='feat/resize-retains-draft','panel action lost draft');
  results.push('Cross-breakpoint resize retains the same inputs, active prompt, ticks and disclosures; panel action dispatches only on click');

  // Local header width, not window width: the screenshot defect occurs in a wide webview.
  await page.goto('http://127.0.0.1:43127/?vault');
  await page.setViewportSize({width:1100,height:700});
  for(const width of [400,310,280,240,210,180,150]){
    await page.locator('#vault-preview').evaluate((e,width)=>{e.style.width=`${width}px`;},width);
    for(const view of ['worktree','sessions']){
      await page.locator(`.vault-view-toggle [data-view="${view}"]`).click();
      const g=await page.locator('.vault-header').evaluate(e=>{
        const r=e.getBoundingClientRect();
        return {left:r.left,right:r.right,overflow:e.scrollWidth-e.clientWidth,buttons:[...e.querySelectorAll('button')].filter(b=>!b.closest('[hidden]')).map(b=>{const r=b.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,name:b.getAttribute('aria-label')};})};
      });
      assert(g.overflow<=1,`header overflow ${width}/${view}: ${JSON.stringify(g)}`);
      for(let i=0;i<g.buttons.length;i++){
        const b=g.buttons[i];assert(b.name&&b.left>=g.left-1&&b.right<=g.right+1,`header control clipped ${width}/${view} ${JSON.stringify(b)}`);
        for(let j=i+1;j<g.buttons.length;j++){const c=g.buttons[j];assert(b.right<=c.left+1||c.right<=b.left+1||b.bottom<=c.top||c.bottom<=b.top,`header overlap ${width}: ${JSON.stringify([b,c])}`);}
      }
      assert(await page.locator(`.vault-view-toggle [data-view="${view}"]`).getAttribute('aria-selected')==='true','view state lost');
    }
  }
  await page.locator('#vault-preview').evaluate(e=>{e.style.width='210px';});
  await page.locator('.vault-view-toggle [data-view="worktree"]').click();
  await page.locator('.vault-header__search-btn[aria-label="Search worktrees"]').click();
  assert(await page.locator('.vault-search-input').isVisible(),'narrow search action unreachable');
  await page.locator('.vault-search-input').fill('keep this query');
  await page.locator('.vault-search-input').press('Escape');
  await page.screenshot({path:'/tmp/compact-worktree-preview/adaptive-vault.png'});
  await page.locator('.vault-header button[aria-label="Create worktree"]').click();
  await page.setViewportSize({width:1100,height:320});
  await geometry(1100,320);
  results.push('Vault header widths 150–400px inside a 1100px webview: no button overlap; named icon tabs, selection, search/create actions PASS; child modal remains viewport-sized');

  await page.goto('http://127.0.0.1:43127/?sparse');
  await page.setViewportSize({width:1100,height:320});
  await page.screenshot({path:'/tmp/compact-worktree-preview/adaptive-wide.png'});
  await page.addStyleTag({content:':root{--vscode-foreground:#292929;--vscode-descriptionForeground:#616161;--vscode-editorWidget-background:#f8f8f8;--vscode-widget-border:#d6d6d6;--vscode-input-background:#fff;--vscode-input-foreground:#292929;--vscode-input-border:#cecece;color-scheme:light;}'});
  await geometry(1100,320);
  await page.screenshot({path:'/tmp/compact-worktree-preview/adaptive-wide-light.png'});
  results.push('Light and dark horizontal form screenshots captured');
  return results;
}
