export async function GET(): Promise<Response> {
  const upstream = await fetch('http://localhost:8000/sources');
  const data = await upstream.json();
  return Response.json(data);
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.json();
  const upstream = await fetch('http://localhost:8000/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await upstream.json();
  return Response.json(data);
}
