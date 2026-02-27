/**
 * Quick test script for the profile-pic API.
 * Run with: node test-api.js
 * Make sure the server is running first: npm start
 */

const BASE = 'http://localhost:4000';

async function testHealth() {
  console.log('1. Testing GET /health ...');
  const res = await fetch(`${BASE}/health`);
  const data = await res.json();
  if (data?.ok) {
    console.log('   OK:', data);
    return true;
  }
  throw new Error('Health check failed: ' + JSON.stringify(data));
}

async function testUpload() {
  console.log('2. Testing POST /api/upload/profile-pic (fake image) ...');
  const blob = new Blob(['fake image content'], { type: 'image/jpeg' });
  const form = new FormData();
  form.append('file', blob, 'test.jpg');
  form.append('userId', 'test-user-' + Date.now());

  const res = await fetch(`${BASE}/api/upload/profile-pic`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json();

  if (res.ok && data?.url) {
    console.log('   OK: Upload succeeded');
    console.log('   URL:', data.url);
    console.log('   Key:', data.key);
    return true;
  }
  console.error('   FAILED. Response status:', res.status);
  console.error('   Body:', data);
  throw new Error('Upload test failed');
}

(async () => {
  try {
    await testHealth();
    await testUpload();
    console.log('\nAll checks passed. API is working.');
  } catch (e) {
    console.error('\nError:', e.message);
    if (e.message.includes('fetch')) {
      console.error('Is the server running? Start it with: npm start');
    }
    process.exit(1);
  }
})();
