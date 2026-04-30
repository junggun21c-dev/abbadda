export default async function handler(req, res) {
  const { code, state } = req.query;

  if (!code) {
    return res.redirect('/?login_error=no_code');
  }

  const tokenUrl = new URL('https://nid.naver.com/oauth2.0/token');
  tokenUrl.searchParams.set('grant_type', 'authorization_code');
  tokenUrl.searchParams.set('client_id', process.env.NAVER_CLIENT_ID);
  tokenUrl.searchParams.set('client_secret', process.env.NAVER_CLIENT_SECRET);
  tokenUrl.searchParams.set('code', code);
  tokenUrl.searchParams.set('state', state);

  const tokenRes = await fetch(tokenUrl.toString());
  const token = await tokenRes.json();

  if (!token.access_token) {
    return res.redirect('/?login_error=token_failed');
  }

  const profileRes = await fetch('https://openapi.naver.com/v1/nid/me', {
    headers: { Authorization: `Bearer ${token.access_token}` }
  });
  const profile = await profileRes.json();

  if (!profile.response) {
    return res.redirect('/?login_error=profile_failed');
  }

  const user = {
    id: profile.response.id,
    name: profile.response.name || profile.response.nickname || '사용자',
    email: profile.response.email || ''
  };

  const encoded = Buffer.from(JSON.stringify(user)).toString('base64');
  res.redirect(`/?nu=${encoded}`);
}
