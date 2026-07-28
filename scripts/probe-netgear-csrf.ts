import 'dotenv/config';

const baseUrl = process.env.NETGEAR_ROUTER_URL!.replace(/\/$/, '');
const username = process.env.NETGEAR_ROUTER_USERNAME!;
const password = process.env.NETGEAR_ROUTER_PASSWORD!;
const authorization = Buffer.from(`${username}:${password}`).toString('base64');

// 只做 GET AccessControl_show.htm — 不发 POST，不改路由器任何设置。
async function probe(index: number) {
  const url = `${baseUrl}/AccessControl_show.htm?ts=${Date.now()}`;
  const start = Date.now();
  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Basic ${authorization}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(8_000),
    });
    const body = resp.ok ? await resp.text() : '';
    const csrf = body.match(/var\s+ts\s*=\s*'(\d+)'/)?.[1];
    console.log(
      `#${index} status=${resp.status} ms=${Date.now() - start} `
      + `csrf=${csrf ?? '<missing>'} bodylen=${body.length}`,
    );
  } catch (error) {
    console.log(`#${index} error=${(error as Error).message}`);
  }
}

async function main() {
  for (let i = 1; i <= 20; i++) {
    await probe(i);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
