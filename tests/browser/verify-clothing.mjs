import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const file=join(tmpdir(),'mira-ar-pose.jpg');
try {await readFile(file);} catch {const r=await fetch('https://storage.googleapis.com/mediapipe-assets/pose.jpg');if(!r.ok)throw Error('Fixture download failed');await writeFile(file,new Uint8Array(await r.arrayBuffer()));}
const report={scope:'Actual Pose IMAGE/VIDEO on official pose.jpg replay, NOT hardware webcam',checks:[],errors:[]};
const check=(v,m)=>{if(!v)throw Error(m);};
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100},acceptDownloads:true});page.on('pageerror',e=>report.errors.push(e.message));
 await page.addInitScript(()=>{window.shirtRows=[];const Original=Worker;window.Worker=class extends Original{constructor(...args){super(...args);this.addEventListener('message',e=>{if(e.data.type==='result')window.shirtRows.push({points:e.data.points.length,liveObservation:!!e.data.liveObservation,frame:!!e.data.frame});});}};});
 await page.goto(process.env.AR_URL ?? 'http://127.0.0.1:5173');await page.getByRole('tab',{name:'Thử áo'}).click();await page.locator('input[type=file]').setInputFiles(file);await page.getByText('Đã nhận diện cơ thể',{exact:true}).waitFor({timeout:60000});
 await page.getByRole('button',{name:'Trắng ngà',exact:true}).click();await page.locator('#size').fill('1.1');
 const dl=page.waitForEvent('download');await page.getByRole('button',{name:'Chụp & lưu ảnh',exact:true}).click();check((await dl).suggestedFilename().endsWith('.png'),'PNG export');report.checks.push('shirt upload, actual Pose, color, size and PNG');
 await page.evaluate(async bytes=>{const image=new Image();image.src=`data:image/jpeg;base64,${bytes}`;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;c.getContext('2d').drawImage(image,0,0);window.shirtStream=c.captureStream(24);Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>window.shirtStream});const tick=()=>{c.getContext('2d').drawImage(image,0,0);window.shirtAnimation=requestAnimationFrame(tick);};tick();},(await readFile(file)).toString('base64'));
 await page.getByRole('button',{name:'Bật camera',exact:true}).click();await page.waitForFunction(()=>window.shirtRows.filter(r=>r.frame&&r.points===33).length>=5,null,{timeout:60000});
 report.rows=await page.evaluate(()=>window.shirtRows);check(report.rows.every(r=>!r.liveObservation),'shirt bypasses bracelet observation pipeline');report.checks.push('actual Pose VIDEO, no bracelet processor');
 await page.getByRole('tab',{name:'Thử vòng tay'}).click();check(await page.evaluate(()=>{cancelAnimationFrame(window.shirtAnimation);return window.shirtStream.getTracks().every(t=>t.readyState==='ended');}),'tab switch releases tracks');report.checks.push('camera cleanup on tab switch');
 await page.setViewportSize({width:390,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow');check(!report.errors.length,'page errors');
 console.log('PASS shirt upload/video/color/size/PNG/tab cleanup/mobile');
} catch(e){report.failure=String(e);throw e;} finally {await writeFile('artifacts/clothing-regression.json',JSON.stringify(report,null,2));await browser.close();}
