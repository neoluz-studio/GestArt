export async function GET(){return Response.json({ok:true,app:"GestArt",version:"13.0.0",mode:process.env.NEXT_PUBLIC_DEMO_MODE==="false"?"real":"demo"});}
