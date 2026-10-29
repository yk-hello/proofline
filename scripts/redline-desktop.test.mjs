import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { launchDesktop, invokeDesktop } from './desktop-session.mjs';

const output = path.resolve(process.env.REDLINE_TEST_OUTPUT || 'test-fixtures/results/redline-desktop-' + Date.now());
const userData = path.join(output, 'profile');
await mkdir(output, {recursive:true});
const file = path.join(output, 'Review 中文 document.md'), original = '# Desktop verification\n\nThe cost is 10.\n\nKeep this paragraph unchanged.\n';
await writeFile(file, original);
const report = {output, platform:process.platform, arch:process.arch, checks:[], errors:[], live:process.argv.includes('--live-gemini')};
let app, page;
async function launch() {
  ({app,page} = await launchDesktop({output,userData,executablePath:process.env.MENGX_TEST_EXECUTABLE}));
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.setViewportSize({width:1440,height:900});
  // Test folder actions without opening Explorer windows.
  await app.evaluate(({shell})=>{shell.openPath=async()=>'';});
  if (await page.locator('.setup-dialog').count()) await page.locator('.setup-dialog').getByRole('button',{name:'完成',exact:true}).click();
}
const invoke = (method,args=[])=>invokeDesktop(app,page,method,args);
const saved = ()=>page.waitForFunction(()=>!window.prooflineReader.getState().document.dirty && window.prooflineReader.getState().document.saveState.status==='saved');
const markSaved = ()=>page.waitForFunction(()=>document.querySelector('.marks-save-status')?.classList.contains('saved'));
const send = async(name)=>{
  await page.locator('.rail-item-send').first().click();
  await page.locator('.send-dialog').waitFor();
  await page.locator('.agent-option').filter({hasText:name}).click({timeout:40000});
  await page.locator('.send-dialog .dialog-actions .primary-button').click();
};
async function close() { await app.evaluate(({app})=>app.exit(0)).catch(()=>{}); await app.close().catch(()=>{}); }
try {
  await launch();
  await invoke('openPath',[file]);
  const mark = await invoke('addNote',[{text:'The cost is 10.',note:'Change exactly 10 to 20. Keep all other text unchanged.'}]);
  await invoke('updateAnnotation',[mark.id,{type:'fix',status:'sent',sentTo:'Previous test'}]);
  await page.locator('.rail-tabs button').first().click();
  await markSaved();
  const exported = await invoke('exportAnnotations');
  assert.equal(exported.ok,true);
  assert.ok(exported.path.startsWith(path.join(userData,'ProoflineData','annotations')));
  assert.equal(JSON.parse(await readFile(exported.path,'utf8')).marks[0].status,'sent');
  assert.equal(await page.locator('.rail-item-send').first().isEnabled(),true);
  report.checks.push('installation-json-bridge','sent-mark-resend');
  if (report.live) {
    await send('Gemini CLI');
    await page.locator('.run-panel').waitFor();
    await page.screenshot({path:path.join(output,'gemini-running.png')});
    await page.locator('.review-view').waitFor({timeout:150000});
    assert.equal(await readFile(file,'utf8'),original,'No write before review acceptance');
    await page.screenshot({path:path.join(output,'gemini-review.png')});
    assert.ok(await page.locator('.review-hunk').count());
    await page.locator('.review-bar').getByRole('button',{name:'全部接受',exact:true}).click();
    await page.locator('.review-bar .primary-button').click();
    await page.locator('.review-view').waitFor({state:'detached'}); await saved();
    assert.equal(await readFile(file,'utf8'),original.replace('10','20'));
    assert.equal((await invoke('getAnnotations'))[0].status,'resolved');
    await page.locator('.rail-item-send').first().click();
    await page.locator('.send-dialog').waitFor();
    await page.locator('.send-dialog .dialog-actions').getByRole('button',{name:'取消',exact:true}).click();
    report.checks.push('live-gemini-ui-run','review-before-write','resolved-mark-resend');
  }
  // Paste real PNG bytes into Milkdown, then save and reopen the app.
  const png = new PNG({width:320,height:160});
  for(let y=0;y<160;y++) for(let x=0;x<320;x++) { const at=(320*y+x)*4; png.data[at]=x<160?255:25; png.data[at+1]=y<80?90:170; png.data[at+2]=100; png.data[at+3]=255; }
  const imageBytes=PNG.sync.write(png);
  await page.locator('.mode-switch button').last().click();
  await page.locator('.ProseMirror').waitFor();
  await page.locator('.ProseMirror p').last().click(); await page.keyboard.press(process.platform==='darwin' ? 'Meta+ArrowRight' : 'End'); await page.keyboard.press('Enter');
  await page.locator('.ProseMirror').evaluate((editor,base64)=>{
    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)), data=new DataTransfer();
    data.items.add(new File([bytes],'pasted.png',{type:'image/png'}));
    editor.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  },imageBytes.toString('base64'));
  await page.waitForFunction(()=>window.prooflineReader.getContent().content.includes('.assets/'));
  await page.locator('.mode-switch button').first().click(); await invoke('save'); await saved();
  const withImage=await readFile(file,'utf8');
  assert.ok(!withImage.includes('blob:')); assert.match(withImage,/\.assets\//);
  const assets=await readdir(file+'.assets'); assert.equal(assets.length,1);
  assert.deepEqual(await readFile(path.join(file+'.assets',assets[0])),imageBytes);
  await page.waitForFunction(()=>[...document.querySelectorAll('.document-content img')].some(i=>i.complete&&i.naturalWidth===320));
  await page.screenshot({path:path.join(output,'image-and-resend.png')});
  // Cross-device package through the actual UI; completed marks can be sent again.
  await page.locator('.rail-item-send').first().click(); await page.locator('.send-dialog').waitFor();
  await page.locator('.agent-option').filter({hasText:'其他 AI / 其他设备'}).click();
  await page.locator('.send-dialog .dialog-actions .primary-button').click();
  await page.locator('.transfer-dialog').getByRole('button',{name:'生成并打开任务文件夹',exact:true}).click();
  await page.locator('.transfer-message').waitFor();
  const taskFolder=await page.locator('.transfer-message').innerText();
  assert.equal(await readFile(path.join(taskFolder,path.basename(file)),'utf8'),withImage);
  assert.deepEqual(await readFile(path.join(taskFolder,path.basename(file)+'.assets',assets[0])),imageBytes);
  await page.locator('.transfer-dialog').getByRole('button',{name:'完成',exact:true}).click();
  await markSaved(); await close(); await launch(); await invoke('openPath',[file]);
  await page.waitForFunction(()=>window.prooflineReader.getAnnotations().length===1);
  await page.waitForFunction(()=>[...document.querySelectorAll('.document-content img')].some(i=>i.complete&&i.naturalWidth===320));
  report.checks.push('paste-image-real-bytes','image-reopen','marks-reopen','portable-task-with-assets');
  // A failing CLI leaves a recoverable partial result and an actionable error.
  const failedScript=path.join(output,'failing-cli.cjs');
  await writeFile(failedScript,'const fs=require("node:fs");const f=process.argv[2];fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace("cost is 20","cost is 30"));console.error("fetch failed ECONNRESET");process.exit(1);');
  await page.evaluate(async({node,script})=>{
    const key='redline-agent-settings-v1', settings=JSON.parse(localStorage.getItem(key)||'{}');
    settings.customs=[{id:'failure-fixture',name:'Failure fixture',template:'"'+node+'" "'+script+'" "{file}"'}];
    await window.mengxDesktop.system.writeAgentSettings(settings);localStorage.setItem(key,JSON.stringify(settings));
  },{node:process.execPath,script:failedScript});
  await page.locator('.rail-tabs button').first().click();
  await send('Failure fixture'); await page.locator('.run-panel.failed').waitFor({timeout:30000});
  assert.match(await page.locator('.run-diagnostic').innerText(),/网络|代理|证书/);
  assert.equal(await readFile(file,'utf8'),withImage);
  await page.locator('.run-actions').getByRole('button',{name:'重新发送',exact:true}).click();
  await page.locator('.send-dialog').waitFor();
  await page.locator('.send-dialog .dialog-actions').getByRole('button',{name:'取消',exact:true}).click();
  await page.locator('.marks-save-status').click();
  await page.locator('.settings-dialog').getByRole('button',{name:'生成 CLI 辅助诊断任务',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.settings-body > .settings-error')?.textContent.includes('诊断任务已保存'));
  const diagnosis=(await page.locator('.settings-body > .settings-error').innerText()).replace('诊断任务已保存：','');
  const snapshot=JSON.parse(await readFile(path.join(diagnosis,'diagnostics.json'),'utf8'));
  assert.ok(snapshot.tools.some(t=>t.id==='gemini'));
  if(report.live) assert.ok(snapshot.tools.some(t=>t.id==='gemini'&&t.available));
  assert.ok(!JSON.stringify(snapshot).includes('The cost is'));
  assert.match(await readFile(path.join(diagnosis,'TASK.md'),'utf8'),/REDLINE_READY/);
  await page.locator('.settings-row').filter({hasText:'Failure fixture'}).getByRole('button',{name:'恢复到审阅',exact:true}).click();
  await page.locator('.review-view').waitFor();
  await page.locator('.review-bar').getByRole('button',{name:'放弃全部',exact:true}).click();
  await page.locator('.review-view').waitFor({state:'detached'});
  report.checks.push('failed-cli-diagnosis','retry-dialog','partial-result-recovery','safe-diagnostic-task');
  // Discarding review A while B is active must not inject A into B's editor.
  const other=path.join(output,'Other.md'), otherSource='# Other document\n\nLeave B alone.\n'; await writeFile(other,otherSource);
  await writeFile(file,withImage.replace('Desktop verification','External revision'));
  await invoke('checkExternalChanges');
  await page.locator('.autosave-state.retry').click();
  await page.locator('.conflict-dialog .primary-button').click();
  await page.locator('.review-view').waitFor(); await invoke('openTab',[other]);
  const otherTab=(await invoke('getTabs')).find(t=>t.active);
  await page.locator('.review-bar').getByRole('button',{name:'放弃全部',exact:true}).click();
  await page.locator('.review-view').waitFor({state:'detached'}); await saved();
  assert.equal(await readFile(file,'utf8'),withImage);
  await invoke('switchTab',[otherTab.id]);
  assert.equal((await invoke('getContent')).content,otherSource);assert.equal(await readFile(other,'utf8'),otherSource);
  await page.setViewportSize({width:1280,height:720}); await page.screenshot({path:path.join(output,'compact-1280.png')});
  report.checks.push('cross-tab-discard-buffer-and-disk');
  assert.deepEqual(report.errors,[]); report.ok=true;
} catch(error) { report.ok=false; report.failure=error.stack; if(page) await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{}); throw error; }
finally { if(app) await close(); await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report)); }
