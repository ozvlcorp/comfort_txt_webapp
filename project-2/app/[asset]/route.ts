import {serveAsset} from '../../server/static.mjs';
export const dynamic='force-dynamic';
export function GET(request:Request){return serveAsset(new URL(request.url).pathname.slice(1));}
