// Local-only visual/behavior harness. Real application assets and modal/save
// handlers; all network access is blocked and mutations are in-memory fixtures.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  const pathname=url.pathname==='/'?'/index.html':url.pathname;
  const allowed=pathname==='/index.html' || pathname==='/tests/manual/record-modal-fixtures.js' ||
    /^\/(?:js|css|assets)\/[^.][^?]*\.(?:js|css|png|svg|jpg|webp|woff2?|ttf)$/.test(pathname);
  if(!allowed) {res.writeHead(404);res.end();return;}
  const file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404);res.end();return;}
  let body=fs.readFileSync(file);
  if(pathname==='/index.html') body=Buffer.from(body.toString().replace('</head>',`<meta http-equiv="Content-Security-Policy" content="connect-src 'self'; form-action 'none';"></head>`).replace('</body>',`<script src="/tests/manual/record-modal-fixtures.js"></script></body>`));
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);
}).listen(Number(process.env.RECORD_FIXTURE_PORT||5188),'127.0.0.1',()=>console.log('Record fixture UI: http://127.0.0.1:5188'));
