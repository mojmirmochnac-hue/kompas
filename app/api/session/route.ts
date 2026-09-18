import {getUser} from '@netlify/identity';

export const runtime='nodejs';
export async function GET(){
  const user=await getUser();
  return Response.json({user:user?{id:user.id,email:user.email,name:user.name}:null},{
    status:user?200:401,
    headers:{'Cache-Control':'no-store'},
  });
}
