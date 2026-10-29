const { chromium } = require('@playwright/test');
const path = require('path');
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1480,height:900}});
  const errors=[];
  page.on('pageerror',e=>errors.push('pageerror:'+e.message));
  page.on('console',m=>{if(m.type()==='error') errors.push('console:'+m.text())});
  await page.goto('http://127.0.0.1:5173/');
  const title=await page.locator('.brand-name').textContent();
  const fileInput=page.locator('input[type=file]').nth(0);
  const fixtures=__dirname;
  async function open(name){
    await fileInput.setInputFiles(path.join(fixtures,name));
    await page.waitForTimeout(500);
    return await page.locator('.document-heading h1').textContent();
  }
  const md=await open('中文技术长文.md');
  const html=await open('sample.html');
  const docx=await open('sample.docx');
  const txt=await open('sample.txt');
  const large=await open('large.md');
  const largeViewport=await page.locator('.large-document-viewport').count();
  await page.getByRole('button',{name:/查找|Find/}).first().click();
  await page.locator('.search-strip input').fill('MENGX-LARGE');
  await page.getByRole('button',{name:/查找|Find/}).last().click();
  await page.waitForTimeout(500);
  const searchCount=await page.locator('.search-result-count').textContent();
  console.log(JSON.stringify({title,md,html,docx,txt,large,largeViewport,searchCount,errors},null,2));
  await browser.close();
})();
