import fetch from 'node-fetch';
async function run() {
  const res = await fetch('http://localhost:3000/api/users/123/nudge');
  const text = await res.text();
  console.log("Status:", res.status);
  console.log("Body:", text);
}
run();
