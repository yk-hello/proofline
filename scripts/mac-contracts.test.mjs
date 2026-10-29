// Executes the production Mac branches with simulated OS services on any host.
// This is not a macOS runtime, Finder, Terminal or vendor-service test.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const require = createRequire(import.meta.url);
const platform = require('../electron/platform.cjs');
const { installationDirectory } = require('../electron/data-store.cjs');
const output = path.resolve('test-fixtures/results/mac-contracts-' + Date.now());
await mkdir(output,{recursive:true});
const checks=[];
for(const [executable,expected] of [
  ['/Applications/Proofline.app/Contents/MacOS/Proofline','/Applications/ProoflineData'],
  ['/Users/测试用户/My Apps/Proofline.app/Contents/MacOS/Proofline','/Users/测试用户/My Apps/ProoflineData'],
  ['/Volumes/Proofline/Proofline.app/Contents/MacOS/Proofline','/Volumes/Proofline/ProoflineData'],
  ['/tmp/AppTranslocation/UUID/d/Proofline.app/Contents/MacOS/Proofline','/tmp/AppTranslocation/UUID/d/ProoflineData'],
  ['/Users/a/parent.app/child/Proofline.app/Contents/MacOS/Proofline','/Users/a/parent.app/child/ProoflineData'],
]) assert.equal(installationDirectory({packaged:true,executable,platform:'darwin',env:{}}),expected);
assert.equal(installationDirectory({packaged:false,appPath:'/Users/测试/source folder',platform:'darwin',env:{}}),'/Users/测试/source folder/.redline-data');
assert.equal(installationDirectory({packaged:true,executable:'/Applications/Proofline.app/Contents/MacOS/Proofline',platform:'darwin',env:{REDLINE_DATA_DIR:'/Users/a/data',PORTABLE_EXECUTABLE_DIR:'C:\\old'}}),'/Users/a/data');
checks.push('mac-storage-install-user-volume-translocation-nested-bundle');
const keys=['GEMINI_CLI_HOME','GEMINI_API_KEY','HTTPS_PROXY'];
const wire='Profile welcome\n\0__REDLINE_ENV_V1__\0PATH\0/opt/homebrew/bin:/usr/bin\0GEMINI_CLI_HOME\0/Users/test/Gemini home\0GEMINI_API_KEY\0test-only-secret\0HTTPS_PROXY\0http://127.0.0.1:9999\0UNLISTED_SECRET\0do-not-import\0__REDLINE_ENV_END__\0profile footer';
const environment=platform.parseLoginEnvironment(wire,keys);
assert.equal(environment.PATH,'/opt/homebrew/bin:/usr/bin'); assert.equal(environment.GEMINI_CLI_HOME,'/Users/test/Gemini home'); assert.equal(environment.UNLISTED_SECRET,undefined);
assert.deepEqual(platform.parseLoginEnvironment('welcome without markers',keys),{});
assert.throws(()=>platform.loginEnvironmentCommand(['BAD;env']),/Invalid environment/);
assert.ok(!platform.loginEnvironmentCommand(keys).includes('env -0'));
assert.deepEqual(await platform.readLoginEnvironment({keys,execute:(_shell,_args,_options,done)=>done(new Error('timeout'),'')}),{});
checks.push('shell-markers-banner-whitelist-timeout');
let terminal;
await platform.openMacTerminal('/Users/测试/My CLI/it\'s tool',['login','--label','a"b;$(touch SHOULD_NOT_RUN)'],{directory:'/Users/测试/Work folder',execute:(executable,args,options,done)=>{terminal={executable,args,options};done(null,'');}});
assert.equal(terminal.executable,'/usr/bin/osascript'); assert.match(terminal.args[1],/^tell application "Terminal" to do script /);
assert.ok(terminal.args[1].includes('cd ')); assert.ok(terminal.args[1].includes('SHOULD_NOT_RUN'));
assert.equal(platform.posixQuote("it's"),"'it'\"'\"'s'");
assert.throws(()=>platform.macLoginScript('/tmp/cli\nunsafe'),/Invalid terminal command/);
await assert.rejects(platform.openMacTerminal('/tmp/tool',[],{execute:(_e,_a,_o,done)=>done(new Error('Automation denied'))}),/Automation denied/);
checks.push('terminal-shell-applescript-escaping-and-errors');
const signals=[],delays=[];
platform.stopProcessTree({pid:9123,exitCode:null,kill:()=>{throw Error('unexpected fallback');}},{platform:'darwin',signal:(pid,name)=>signals.push([pid,name]),delay:(callback,ms)=>{delays.push(ms);callback();return {unref(){}};}});
assert.deepEqual(signals,[[-9123,'SIGTERM'],[-9123,'SIGKILL']]); assert.deepEqual(delays,[1500]);
let fallback=false;
platform.stopProcessTree({pid:9124,exitCode:null,kill:()=>{fallback=true;}},{platform:'darwin',signal:()=>{throw Error('group absent');},delay:()=>({unref(){}})});assert.ok(fallback);
checks.push('posix-process-group-termination-escalation');

const home='/Users/测试 user', commands=new Map([
  ['/opt/homebrew/bin/claude',{id:'claude-code',help:'-p --permission-mode --allowedTools'}],
  ['/usr/local/bin/codex',{id:'codex',help:'--skip-git-repo-check --sandbox --json'}],
  [home+'/.nvm/versions/node/v24.1.0/bin/gemini',{id:'gemini',help:'-p --approval-mode --output-format --skip-trust'}],
  [home+'/Library/pnpm/qwen',{id:'qwen',help:'-p --approval-mode'}],
  [home+'/.local/bin/kimi',{id:'kimi',help:'--print --prompt'}],
  ['/usr/local/bin/agent',{id:'cursor-agent',help:'-p --force'}],
  ['/usr/local/bin/iflow',{id:'iflow',help:'-p --yolo',notExecutable:true}],
]);
const launches=[],reads=[];
const missing=()=>Object.assign(new Error('not found'),{code:'ENOENT'});
const fakeFs={
  stat:async file=>{if(!commands.has(file)) throw missing();return {isFile:()=>true};},
  access:async file=>{if(commands.get(file)?.notExecutable) throw Object.assign(new Error('EACCES'),{code:'EACCES'});},
  readdir:async root=>{if(root===home+'/.nvm/versions/node') return ['v20.0.0','v24.1.0'];throw missing();},
  readFile:async file=>{reads.push(file);if(file==='/Users/test/Gemini home/settings.json')return JSON.stringify({security:{auth:{selectedType:'gemini-api-key'}}});throw missing();},
};
const fakeChild={
  execFile:(shell,args,options,done)=>{assert.equal(shell,'/bin/zsh');assert.equal(args[0],'-ilc');done(null,wire);},
  spawn:(executable,args,options)=>{
    launches.push({executable,args,env:options.env});
    const child=new EventEmitter(); child.pid=10000+launches.length;child.exitCode=null;child.stdout=new PassThrough();child.stderr=new PassThrough();
    setImmediate(()=>{const spec=commands.get(executable);let code=0,text='';
      if(args.includes('--version')) text='1.2.3-simulated';else if(args.includes('--help'))text='Options: '+spec.help;else if(spec.id==='codex'&&args[0]==='login'){code=1;text='Not logged in';}else text='REDLINE_READY';
      child.stdout.end(text+'\n'); child.stderr.end();child.exitCode=code;child.emit('close',code);
    });return child;
  },
};
async function loadProduction(filename,stubs){const module={exports:{}};const source=await readFile(new URL('../electron/'+filename,import.meta.url),'utf8');
  const context={module,exports:module.exports,require:id=>stubs[id]??require(id),process:{platform:'darwin',env:{PATH:'/usr/bin:/bin',SHELL:'/bin/zsh'},kill:()=>{}},Buffer,setTimeout,clearTimeout,setInterval,clearInterval,console};
  vm.runInNewContext(source,context,{filename});return module.exports;
}
const macPlatform=await loadProduction('platform.cjs',{'node:path':path.posix,'node:child_process':fakeChild,'node:fs/promises':fakeFs});
const agents=await loadProduction('agents.cjs',{'node:path':path.posix,'node:child_process':fakeChild,'node:fs/promises':fakeFs,'node:os':{homedir:()=>home},'./platform.cjs':macPlatform});
const detected=await agents.detect({}, {refresh:true});
for(const id of ['claude-code','codex','gemini','qwen','kimi','cursor-agent']){const item=detected.find(item=>item.id===id);assert.equal(item.available,true,id);assert.equal(item.compatibility.ok,true,id);}
assert.equal(detected.find(item=>item.id==='iflow').available,false,'non-executable shims must be rejected');
assert.equal(detected.find(item=>item.id==='codex').auth,'required');
assert.equal(detected.find(item=>item.id==='gemini').auth,'configured');
assert.ok(reads.includes('/Users/test/Gemini home/settings.json'),'login-shell Gemini home must be used');
assert.ok(launches.every(call=>call.env.PATH.includes('/opt/homebrew/bin')&&!call.env.PATH.includes('Profile welcome')&&!('Path' in call.env)));
assert.ok(launches.every(call=>call.env.GEMINI_API_KEY==='test-only-secret'&&!('UNLISTED_SECRET' in call.env)));
checks.push('production-darwin-detect-homebrew-intel-nvm-pnpm-localbin-alias','production-darwin-executable-permissions','production-darwin-provider-home-and-env','production-darwin-login-state');
const extra=await platform.macSearchDirectories(home,{readDirectory:async()=>['v20.0.0','v24.1.0']});
assert.ok(extra.includes(home+'/Library/Application Support/fnm/node-versions/v24.1.0/installation/bin'));
assert.ok(extra.includes(home+'/.volta/bin'));assert.ok(extra.includes(home+'/Library/pnpm'));
checks.push('fnm-nvm-volta-bun-pnpm-search-plans');
const packageJson=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
assert.equal(packageJson.build.electronDist,undefined,'a host-only Electron dist cannot build a universal Mac runtime');
assert.ok(packageJson.scripts['desktop:pack'].includes('--config.electronDist='));
checks.push('mac-universal-runtime-config-review');
// Execute the real Electron entry point with inert services, then deliver file events.
const appEvents=new EventEmitter();
Object.assign(appEvents,{setName(){},setAppUserModelId(){},isPackaged:false,getPath:()=>home+'/Library/Application Support/Proofline',requestSingleInstanceLock:()=>true,whenReady:()=>new Promise(()=>{}),quit(){}});
const received=[],mainContext=vm.createContext({require:id=>id==='electron'?{app:appEvents,protocol:{registerSchemesAsPrivileged(){}}}:id==='node:path'?path.posix:id==='node:fs'?{existsSync:()=>true}:require(id.startsWith('./')?'../electron/'+id.slice(2):id),module:{exports:{}},process:{platform:'darwin',env:{},argv:['electron','.'],},console,URL,Response,Headers,setTimeout,clearTimeout,setInterval,clearInterval});
vm.runInContext(await readFile(new URL('../electron/main.cjs',import.meta.url),'utf8'),mainContext,{filename:'electron/main.cjs'});
let prevented=0;
appEvents.emit('open-file',{preventDefault(){prevented++;}},'/Users/test/中文 one.md');
assert.equal(vm.runInContext('pendingOpen[0]',mainContext),'/Users/test/中文 one.md');
mainContext.fakeFiles={grant:async filename=>({path:filename,name:path.posix.basename(filename)})};
mainContext.fakeWindow={isMinimized:()=>false,focus(){},webContents:{send:(channel,payload)=>received.push({channel,payload})}};
vm.runInContext('files=fakeFiles;window=fakeWindow;rendererReady=true;void deliverOpen();',mainContext);
await new Promise(resolve=>setImmediate(resolve));assert.equal(received[0].payload.path,'/Users/test/中文 one.md');
vm.runInContext('openingFile=false;',mainContext);
appEvents.emit('open-file',{preventDefault(){prevented++;}},'/Users/test/中文 two.md');await new Promise(resolve=>setImmediate(resolve));
assert.equal(received[1].payload.path,'/Users/test/中文 two.md');assert.equal(prevented,2);
checks.push('production-open-file-before-and-after-renderer-ready');
const report={ok:true,host:process.platform,arch:process.arch,macHostVerified:false,evidence:'production Mac code with simulated OS services; pure path and command tests',checks,output};
await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
