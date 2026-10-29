// Run on macOS without creating an app bundle, DMG or ZIP.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { launchDesktop } from './desktop-session.mjs';
const require=createRequire(import.meta.url);
const {macLoginScript,readLoginEnvironment}=require('../electron/platform.cjs');
const {DataStore}=require('../electron/data-store.cjs');
const {which,runCommand}=require('../electron/agents.cjs');
const output=path.resolve(process.env.REDLINE_MAC_OUTPUT || 'test-fixtures/results/mac-native-'+Date.now());
await mkdir(output,{recursive:true});
const report={host:process.platform,arch:process.arch,checks:[],skipped:[],output};
async function main(){
  if(process.platform!=='darwin'){report.status='skipped';report.reason='Requires a real macOS host';report.macHostVerified=false;console.log(JSON.stringify(report));return;}
  const script=path.join(output,'terminal-login.applescript');
  await writeFile(script,macLoginScript('/Users/Test user/it\'s CLI',['login','a"b;$(echo inert)'],'/Users/Test user/中文'));
  await promisify(execFile)('/usr/bin/osacompile',['-o',path.join(output,'terminal-login.scpt'),script]);
  report.checks.push('native-applescript-compilation-without-opening-terminal');
  const inherited=await readLoginEnvironment({shell:process.env.SHELL||'/bin/zsh',keys:['HTTPS_PROXY','GEMINI_CLI_HOME']});
  assert.ok(inherited.PATH);report.checks.push('native-login-shell-marked-path');
  const cli=path.join(output,'local cli');await writeFile(cli,'#!/bin/sh\nprintf "REDLINE_READY\\n"\n');await chmod(cli,0o644);
  assert.equal(await which(cli),null);await chmod(cli,0o755);assert.equal(await which(cli),cli);
  const response=await runCommand(cli,[],{cwd:output});assert.equal(response.ok,true);assert.match(response.stdout,/REDLINE_READY/);
  report.checks.push('native-executable-permission-and-posix-script');
  const readonly=path.join(output,'readonly');await mkdir(readonly);await chmod(readonly,0o555);
  try{if(process.getuid?.()===0)report.skipped.push('readonly-directory: root user bypasses permissions');else{assert.equal((await new DataStore(path.join(readonly,'ProoflineData')).init()).writable,false);report.checks.push('native-readonly-storage-detection');}}
  finally{await chmod(readonly,0o755);}
  const stubborn=path.join(output,'stubborn.cjs');await writeFile(stubborn,'process.on("SIGTERM",()=>{});console.log("STARTED");setInterval(()=>{},1000);');
  const stopped=await runCommand(process.execPath,[stubborn],{cwd:output,timeout:1000});
  assert.equal(stopped.timedOut,true);assert.match(stopped.stdout,/STARTED/);report.checks.push('native-process-group-force-stop');
  const {app,page}=await launchDesktop({output,userData:path.join(output,'profile')});
  try{
    if(await page.locator('.setup-dialog').count())await page.locator('.setup-dialog').getByRole('button',{name:'完成',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.mengxDesktop.platform),'darwin');
    const native=await app.evaluate(({Menu,BrowserWindow})=>({menuRoles:Menu.getApplicationMenu().items.map(item=>item.role?.toLowerCase()),windowCount:BrowserWindow.getAllWindows().length}));
    assert.ok(native.menuRoles.includes('editmenu'));report.checks.push('native-mac-menu-and-window');
    const source=path.join(output,'Finder 中文 test.md');await writeFile(source,'# Finder event test\n\nOriginal text.\n');
    // Tests the actual open-file handler. An OS-generated Finder event still needs manual QA.
    await app.evaluate(({app},filename)=>app.emit('open-file',{preventDefault(){}},filename),source);
    await page.waitForFunction(()=>window.prooflineReader.getState().document.name==='Finder 中文 test.md');
    assert.match((await page.evaluate(()=>window.prooflineReader.getContent())).content,/Original text/);
    await page.keyboard.press('Meta+f');await page.locator('.search-strip input').waitFor();await page.keyboard.press('Escape');
    await page.screenshot({path:path.join(output,'native-mac.png')});report.checks.push('native-open-file-handler-injected-event','native-command-f');
    assert.match(await readFile(source,'utf8'),/Original text/);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
  report.status='passed';report.macHostVerified=true;
}
try{await main();}catch(error){report.status='failed';report.failure=error.stack;process.exitCode=1;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
