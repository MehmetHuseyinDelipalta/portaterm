// Real WorktreeView/VaultPanel and current CSS; callbacks simulated by local harness.
async page => {
  await page.route('http://127.0.0.1:43127/**', route => route.continue());
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const results=[];
  const open=async scenario=>{
    await page.goto(`http://127.0.0.1:43127/?vault&tree=${scenario}`);
    await page.setViewportSize({width:1100,height:900});
    await page.locator('#app').evaluate(e=>{e.style.width='400px';e.style.height='800px';});
    await page.locator('#vault-preview').evaluate(e=>{e.style.width='100%';e.style.height='800px';});
  };
  for(const scenario of ['single','multi']){
    await open(scenario);
    const footer=page.locator('.wt-create-worktree').last();
    const repoIds=await page.evaluate(()=>window.treePreview.tree.repos.map(r=>r.repoId));
    assert(await page.locator('.wt-create-worktree').count()===repoIds.length,'footer count');
    await page.locator('.wt-tree [role="treeitem"][tabindex="0"]').focus();
    await page.keyboard.press('End');
    assert(await footer.evaluate(e=>document.activeElement===e),'End misses footer');
    assert(await footer.getAttribute('aria-level')===(scenario==='multi'?'2':'1'),'wrong hierarchy');
    await page.keyboard.press('ArrowUp');
    assert(!await footer.evaluate(e=>document.activeElement===e),'Up stuck on footer');
    await page.keyboard.press('ArrowDown');
    assert(await footer.evaluate(e=>document.activeElement===e),'Down misses footer');
    for(const key of ['Enter','Space']) await page.keyboard.press(key);
    assert(JSON.stringify(await page.evaluate(()=>window.createdRepoIds))===JSON.stringify([repoIds.at(-1),repoIds.at(-1)]),'native keys do not activate exactly once for own repo');
    await page.evaluate(()=>window.treePreview.repaint());
    assert(await footer.evaluate(e=>document.activeElement===e),'repaint loses footer focus');
    assert(await page.locator('.wt-tree [role="treeitem"][tabindex="0"]').count()===1,'multiple tree stops');
    await page.keyboard.press('ArrowRight');
    assert(await footer.evaluate(e=>document.activeElement===e),'leaf Right moves focus');
    await page.keyboard.press('ArrowLeft');
    if(scenario==='multi') assert(await page.locator('.wt-repo').last().evaluate(e=>document.activeElement===e),'Left misses parent');
    else assert(await footer.evaluate(e=>document.activeElement===e),'single repo Left leaves leaf');
    results.push(`${scenario}: native Enter/Space dispatch once, arrows/hierarchy/repaint/roving stop PASS`);
  }
  await open('main');
  assert(await page.locator('.wt-tree .vault-empty-title').textContent()==='No other worktrees yet','main-only hint changed');
  assert(await page.locator('.wt-create-worktree').count()===0 && await page.locator('.wt-empty-inline .vault-empty-action').count()===1,'duplicate main-only action');
  await open('disabled');
  assert(await page.locator('.wt-create-worktree').count()===0,'unavailable create offered');
  await open('many');
  assert(await page.locator('.wt-showall').count()===1,'cap fixture did not cap');
  assert(await page.locator('.wt-create-worktree').evaluate(e=>e===e.parentElement.lastElementChild),'footer not last');
  await page.locator('.wt-showall').click();
  assert(await page.locator('.wt-create-worktree').count()===1,'uncapping duplicates footer');
  await page.evaluate(()=>window.treePreview.view.setQuery('not-a-real-branch-unique'));
  assert(await page.locator('.wt-create-worktree').count()===0,'no-match create offered');
  results.push('main-only, unavailable callback, cap/uncap, no-match PASS');
  await open('single');
  for(const width of [80,100,140,210,280,320,400,760]){
    await page.locator('#app').evaluate((e,w)=>{e.style.width=`${w}px`;},width);
    const row=page.locator('.wt-row').first();
    await page.mouse.move(1000,850);
    const before=await row.evaluate(e=>{
      const r=e.getBoundingClientRect(),m=e.querySelector('.wt-marks').getBoundingClientRect(),t=e.querySelector('.wt-rowtools').getBoundingClientRect(),b=e.querySelector('.wt-branch');
      const label=b.getBoundingClientRect();
      return {r:r.right,pad:parseFloat(getComputedStyle(e).paddingRight),m:{left:m.left,right:m.right,top:m.top},t:{right:t.right},branchWidth:label.width,labelRight:label.right-parseFloat(getComputedStyle(b).paddingRight),toolsLeft:t.left};
    });
    await row.hover();
    const after=await row.locator('.wt-marks').boundingBox();
    assert(Math.abs(after.x-before.m.left)<1,'hover moves chips');
    assert(before.branchWidth>=20,'branch collapsed');
    if(width>220){
      assert(Math.abs(before.r-before.pad-before.m.right)<1,'chips inset after actions');
      assert(before.t.right<=before.m.left && before.labelRight<=before.toolsLeft+1,'actions overlap text or chips');
    } else {
      assert(await row.locator('.wt-badge').evaluateAll(es=>es.every(e=>e.getBoundingClientRect().right<=e.closest('.wt-row').getBoundingClientRect().right)),'narrow badge clipped');
    }
    results.push(`${width}px: actual row geometry, stable trailing chips, action clearance PASS`);
  }
  await page.locator('#app').evaluate(e=>{e.style.width='400px';});
  await page.locator('#vault-preview').screenshot({path:'/tmp/compact-worktree-preview/create-footer-final.png'});
  return results;
}
