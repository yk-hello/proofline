// Native-host validation only. This script never invokes electron-builder.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
const output=path.resolve('test-fixtures/results/mac-verification-'+Date.now());await mkdir(output,{recursive:true});
const report={host:process.platform,arch:process.arch,packaging:false,macHostVerified:false,stages:[],output};
if(process.platform!=='darwin'){
  report.status='skipped';report.reason='This command requires macOS; use test:mac-contracts for off-host checks.';
}else{
  const stages=[['contracts','scripts/mac-contracts.test.mjs'],['core','scripts/redline-core.test.mjs'],['storage','scripts/agents-storage.test.mjs'],['adapters','scripts/cli-adapters.test.mjs'],['web-build','node_modules/vite/bin/vite.js','build'],['desktop','scripts/redline-desktop.test.mjs',...(process.argv.includes('--live-gemini')?['--live-gemini']:[])],['native','scripts/mac-native.test.mjs']];
  report.status='running';
  for(const [name,...args] of stages){
    console.log('Running '+name+'; log: '+path.join(output,name+'.log'));
    const result=await new Promise(resolve=>{
      const stream=createWriteStream(path.join(output,name+'.log'));
      const child=spawn(process.execPath,args,{env:{...process.env,REDLINE_TEST_OUTPUT:path.join(output,'desktop'),REDLINE_MAC_OUTPUT:path.join(output,'native')},stdio:['ignore','pipe','pipe']});
      child.stdout.pipe(stream,{end:false});child.stderr.pipe(stream,{end:false});
      child.once('error',error=>{stream.end();resolve({code:1,error:error.message});});
      child.once('close',code=>stream.end(()=>resolve({code})));
    });
    report.stages.push({name,...result});await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
    if(result.code!==0){report.status='failed';process.exitCode=1;break;}
  }
  if(report.status==='running'){report.status='passed';report.macHostVerified=true;}
}
await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
