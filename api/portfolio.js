// KIS (Korea Investment Securities) API Proxy
// Handles CORS bypass for browser clients.
// Flow: receive credentials from client -> optionally reuse cached token -> query balance / KOSPI

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';

// Issue a new OAuth2 bearer token from KIS
async function issueToken(appkey, appsecret) {
  const res = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey, appsecret })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token issuance failed [${res.status}]: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return {
    token: `${data.token_type} ${data.access_token}`,
    expires_in: data.expires_in || 86400
  };
}

// Query domestic stock balance (actual investment account)
async function getBalance(token, appkey, appsecret, accountNo, productCode) {
  const params = new URLSearchParams({
    CANO: accountNo,
    ACNT_PRDT_CD: productCode,
    AFHR_FLPR_YN: 'N',
    OFL_YN: '',
    INQR_DVSN: '02',
    UNPR_DVSN: '01',
    FUND_STTL_ICLD_YN: 'N',
    FNCG_AMT_AUTO_RDPT_YN: 'N',
    PRCS_DVSN: '01',
    CTX_AREA_FK100: '',
    CTX_AREA_NK100: ''
  });
  const res = await fetch(
    `${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-balance?${params}`,
    {
      headers: {
        Authorization: token,
        appkey,
        appsecret,
        tr_id: 'TTTC8434R',
        custtype: 'P'
      }
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Balance query failed [${res.status}]: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// Query KOSPI composite index current price
async function getKospiPrice(token, appkey, appsecret) {
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'U',
    FID_INPUT_ISCD: '0001'
  });
  const res = await fetch(
    `${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-index-price?${params}`,
    {
      headers: {
        Authorization: token,
        appkey,
        appsecret,
        tr_id: 'FHPUP02100000',
        custtype: 'P'
      }
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`KOSPI query failed [${res.status}]: ${text.slice(0, 200)}`);
  }
  return res.json();
}

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: true, message: 'Method not allowed' });
    return;
  }

  const {
    appkey, appsecret, accountNo, productCode,
    cachedToken, tokenExpiresAt, action
  } = req.body || {};

  if (!appkey || !appsecret) {
    res.status(400).json({ error: true, message: 'API keys are required' });
    return;
  }

  try {
    const TOKEN_BUFFER = 5 * 60 * 1000; // 5-minute safety buffer
    const now = Date.now();
    let token;
    let newTokenData = null;

    if (cachedToken && tokenExpiresAt && now < (tokenExpiresAt - TOKEN_BUFFER)) {
      // Reuse valid cached token supplied by the client
      token = cachedToken;
      console.log('[portfolio] Reusing cached token');
    } else {
      console.log('[portfolio] Issuing new token');
      const result = await issueToken(appkey, appsecret);
      token = result.token;
      newTokenData = { token, expires_at: now + result.expires_in * 1000 };
    }

    if (action === 'token') {
      res.status(200).json({
        token,
        expires_at: newTokenData ? newTokenData.expires_at : tokenExpiresAt
      });
      return;
    }

    if (action === 'balance') {
      if (!accountNo || !productCode) {
        res.status(400).json({ error: true, message: 'accountNo and productCode required' });
        return;
      }
      const balance = await getBalance(token, appkey, appsecret, accountNo, productCode);
      res.status(200).json({ balance, ...(newTokenData && { newToken: newTokenData }) });
      return;
    }

    if (action === 'kospi') {
      const kospi = await getKospiPrice(token, appkey, appsecret);
      res.status(200).json({ kospi, ...(newTokenData && { newToken: newTokenData }) });
      return;
    }

    res.status(400).json({ error: true, message: `Unknown action: ${action}` });
  } catch (err) {
    console.error('[portfolio] Error:', err.message);
    res.status(500).json({ error: true, message: err.message });
  }
};
