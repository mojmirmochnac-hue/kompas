import {errorStatus,json,migrateLegacyData,owner} from '@/lib/store';

export const runtime='nodejs';

export async function POST(req:Request){
  try{
    const targetOwner=await owner(req);
    const body=await req.json().catch(()=>({})) as {code?:unknown};
    const code=typeof body.code==='string'?body.code.trim():'';
    if(code.length>100)return json({error:'Migračný kód je príliš dlhý.'},400);
    return json(await migrateLegacyData(req,targetOwner,code));
  }catch(error){
    return json({error:(error as Error).message},errorStatus(error));
  }
}
