import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from '../api/lostark-sync.js';
const root = path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const fixtures=process.argv.includes('--fixtures');
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/lostark-sync') {
      let body='';for await(const chunk of req){body+=chunk;if(body.length>8192){res.writeHead(413);res.end();return;}}
      try {req.body=body?JSON.parse(body):{};}catch{res.writeHead(400);res.end();return;}
      res.status=s=>{res.statusCode=s;return res;};res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
      await handler(req,res);return;
    }
    const allowed=new Set(['/','/index.html','/app.js','/config.js','/lib/domain.js','/logo.png']);
    if(fixtures) allowed.add('/tests/browser-fixture.js');
    if(!allowed.has(url.pathname)){res.writeHead(404);res.end();return;}
    const filename=path.join(root,url.pathname==='/'?'index.html':url.pathname.slice(1));
    let content=await fs.readFile(filename);
    if(fixtures && path.extname(filename)==='.html') content=content.toString().replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2','/tests/browser-fixture.js');
    res.writeHead(200,{'Content-Type':types[path.extname(filename)],'Cache-Control':'no-store'});res.end(content);
  }catch{res.writeHead(500);res.end('Local server error');}
});
const port=Number(process.env.PORT || (fixtures?4174:4173));
server.listen(port,'127.0.0.1',()=>console.log(`Preview: http://127.0.0.1:${port}${fixtures?' (isolated fixtures; no production writes)':''}`));
