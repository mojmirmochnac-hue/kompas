export const runtime='nodejs';
export async function GET(req:Request){
  const existing=req.headers.get('cookie')?.match(/(?:^|;\s*)kompas_session=([a-f0-9]{32})/)?.[1];
  const headers=new Headers({'Cache-Control':'no-store','Content-Type':'application/json'});
  if(!existing){
    const id=crypto.randomUUID().replaceAll('-','');
    headers.append('Set-Cookie',`kompas_session=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`);
  }
  return new Response(JSON.stringify({ok:true}),{headers});
}
