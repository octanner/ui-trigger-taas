const axios = require('axios').default;
const express = require('express');
const bodyParser = require('body-parser');

const app = express();

app.use(bodyParser.json());

// Environment variables
const PORT = process.env.PORT || 9000;
const AKKERIS_API_TOKEN = process.env.AKKERIS_API_TOKEN;
const AKKERIS_API_URL = process.env.AKKERIS_API_URL || 'https://controller-api.maru.octanner.io';
const UI_IMAGE_TAG_PREFIX = process.env.UI_IMAGE_TAG_PREFIX || 'release-';
const UI_IMAGE_REPO = process.env.UI_IMAGE_REPO || 'akkeris/ui';
const TAAS_URL = process.env.TAAS_URL || 'https://taas-maru.octanner.io';
const TAAS_TEST_NAME = process.env.TAAS_TEST_NAME || 'ui-tests-taas';

// Check for required environment variables
if (!AKKERIS_API_TOKEN) {
  console.log('Missing AKKERIS_API_TOKEN environment variable.')
  process.exit(1);
}

// Standard Axios config for Akkeris authentication
const akkeris_auth_config = { headers: { 'Authorization': `${AKKERIS_API_TOKEN}` } };

// Flux runs every five minutes (i.e. 5:35 PM, 5:40 PM, etc.)
// We only want to trigger a test after Flux has had a chance to run (one minute after Flux runs)
// This means we want to run at the sixth minute interval (i.e. 5:36 PM, 5:41 PM, etc.)
function getTimeTillTrigger() {
  const oneMin = 1000 * 60;
  const fiveMin = oneMin * 5;
  const currentTime = (new Date()).getTime();
  const nextTime = new Date(Math.ceil((currentTime / fiveMin) * fiveMin) + oneMin).getTime();
  return nextTime - currentTime;
}

async function triggerBuild(tag, payload) {
  try {
    console.log(`Triggering TaaS test run for image akkeris/ui:${tag} on test ${TAAS_TEST_NAME}...`);
    await axios.post(`${TAAS_URL}/v1/releasehook`, JSON.stringify(payload), akkeris_auth_config);
    console.log(`Test run triggered successfully!`);
  } catch (err) {
    console.log('ERROR: ', err.message);
  }
}

// POST handler for incoming webhook
app.post('/hook', async (req, res) => {
  console.log('POST /hook');

  const hook = req.body;

  if (!hook.repository || !hook.push_data || !hook.push_data.tag) {
    console.log('ERROR: Invalid hook payload.');
    res.sendStatus(400);
    return;
  }

  if (hook.repository.repo_name !==  UI_IMAGE_REPO) {
    console.log('INFO: Received valid hook, but repo did not match expected. Ignored webhook.');
    res.sendStatus(200);
    return;
  }

  if (!(hook.push_data && hook.push_data.tag && hook.push_data.tag.startsWith(UI_IMAGE_TAG_PREFIX))) {
    console.log('INFO: Recieved valid hook, but image tag did not match required prefix. Ignored webhook.')
    res.sendStatus(200);
    return;
  }

  res.sendStatus(200);

  try {
    const { data } = await axios.get(`${TAAS_URL}/v1/diagnostic/${TAAS_TEST_NAME}`, { 'Content-Type': 'text/plain' });
    const { app, space, id, action, result } = data; 

    const { data: releases } = await axios.get(`${AKKERIS_API_URL}/apps/${app}-${space}/releases`, akkeris_auth_config);

    const payload = {
      action,
      app: { id, name: app },
      space: { name: space },
      release: { result, id: releases.pop().id }, // Get latest image for app targeted by TaaS test
      build: { id: '' },
    };

    console.log(`Scheduling trigger for image ${UI_IMAGE_REPO}:${hook.push_data.tag} on test ${TAAS_TEST_NAME}...`)

    // Schedule TaaS build trigger for the appropriate time
    setTimeout(() => triggerBuild(hook.push_data.tag, payload), getTimeTillTrigger());
    
  } catch (err) {
    console.log('ERROR: ', err.message);
  }
})

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}...`);
})