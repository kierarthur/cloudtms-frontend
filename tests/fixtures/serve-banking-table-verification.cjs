// Loopback-only, exact-file allowlist. No proxy, auth files, directory serving,
// API endpoints, mutation or external request is provided by this test server.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const files=new Map([
  ['/',[path.join(__dirname,'banking-pay-v2-table-browser.html'),'text/html']],
  ['/candidate',[path.join(__dirname,'banking-pay-v2-candidate-browser.html'),'text/html']],
  ['/issues',[path.join(__dirname,'banking-pay-v2-issues-browser.html'),'text/html']],
  ['/issues-test.js',[path.join(__dirname,'banking-pay-v2-issues-browser.js'),'text/javascript']],
  ['/issues.js',[path.resolve(__dirname,'../../js/banking-pay-modal-v2-issues.js'),'text/javascript']],
  ['/detail-fixture.js',[path.join(__dirname,'banking-pay-v2-detail-page.cjs'),'text/javascript']],
  ['/candidate-test.js',[path.join(__dirname,'banking-pay-v2-candidate-browser.js'),'text/javascript']],
  ['/legacy-details.js',[path.resolve(__dirname,'../../js/banking-pay-modal-v2-details-legacy.js'),'text/javascript']],
  ['/candidate.js',[path.resolve(__dirname,'../../js/banking-pay-modal-v2-candidate.js'),'text/javascript']],
  ['/fixture.js',[path.join(__dirname,'banking-pay-v2-table-page.cjs'),'text/javascript']],
  ['/browser-test.js',[path.join(__dirname,'banking-pay-v2-table-browser.js'),'text/javascript']],
  ['/table.js',[path.resolve(__dirname,'../../js/banking-pay-modal-v2-table.js'),'text/javascript']],
  ['/copy.js',[path.resolve(__dirname,'../../js/banking-pay-modal-v2-copy.js'),'text/javascript']],
  ['/banking-table.css',[path.resolve(__dirname,'../../css/banking-pay-modal-v2.css'),'text/css']],
  ['/theme.css',[path.resolve(__dirname,'../../css/modal-modernisation.css'),'text/css']]
]);
http.createServer((request,response)=>{
  const file=files.get(request.url);
  if(request.method!=='GET'||!file){response.writeHead(404);response.end();return;}
  response.writeHead(200,{'content-type':`${file[1]}; charset=utf-8`,'cache-control':'no-store',
    'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'self'; frame-src 'none'; base-uri 'none'; form-action 'none'"});
  fs.createReadStream(file[0]).pipe(response);
}).listen(process.argv.includes('--issues')?18744:process.argv.includes('--candidate')?18743:18742,'127.0.0.1',()=>console.log(process.argv.includes('--issues')
  ?'Synthetic Banking issue verification: http://127.0.0.1:18744/issues'
  :process.argv.includes('--candidate')
  ?'Synthetic Candidate Banking verification: http://127.0.0.1:18743/candidate'
  :'Synthetic Banking table verification: http://127.0.0.1:18742/'));
