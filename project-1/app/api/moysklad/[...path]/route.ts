import {env} from 'cloudflare:workers';
import {handleMoySklad} from '../../../../server/moysklad.mjs';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleMoySklad(request,env);}
export function POST(request:Request){return handleMoySklad(request,env);}
