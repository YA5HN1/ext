// Constants
const API_KEY = 'AIzaSyBoKzwUFlqFJd4B7VK3Xg9i8D37-0wdLP0';
const ASSEMBLY_API_KEY = '1860e6a93d4a41479ba55e05faa7891d';
const FRAME_INTERVAL = 3000; // 3 seconds between frames

// DOM Elements
const uploadButton = document.getElementById('uploadButton');
const videoInput = document.getElementById('videoInput');
const videoPreview = document.getElementById('videoPreview');
const canvas = document.getElementById('canvas');
const progressContainer = document.querySelector('.progress-container');
const progressBar = document.querySelector('.progress-bar');
const progressText = document.getElementById('progressText');
const summaryDiv = document.getElementById('summary');
const frameAnalysisDiv = document.getElementById('frameAnalysis');
const transcriptionDiv = document.getElementById('transcription');

// Event Listeners
uploadButton.addEventListener('click', () => videoInput.click());
videoInput.addEventListener('change', handleVideoSelect);

// Main video processing function
async function handleVideoSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    // Setup UI
    setupUI(file);
    
    // Initialize processing
    const ctx = canvas.getContext('2d');
    await setupVideo(file);
    
    // Process video frames
    const frameDescriptions = await processVideoFrames(ctx);
    
    // Process audio
    const transcript = await transcribeAudio(file);
    
    // Generate final summary
    const summary = await generateVideoSummary(frameDescriptions, transcript);
    
    // Update UI with results
    updateResults(summary, frameDescriptions, transcript);

  } catch (error) {
    handleError(error);
  }
}

// UI Setup
function setupUI(file) {
  videoPreview.style.display = 'block';
  videoPreview.src = URL.createObjectURL(file);
  progressContainer.style.display = 'block';
  summaryDiv.textContent = 'Analyzing video...';
  frameAnalysisDiv.textContent = 'Processing frames...';
  transcriptionDiv.textContent = 'Preparing transcription...';
}

// Video Setup
async function setupVideo(file) {
  await new Promise(resolve => videoPreview.addEventListener('loadedmetadata', resolve));
  canvas.width = videoPreview.videoWidth;
  canvas.height = videoPreview.videoHeight;
}

// Frame Processing
async function processVideoFrames(ctx) {
  const frameDescriptions = [];
  const duration = videoPreview.duration * 1000;
  let currentTime = 0;

  while (currentTime < duration) {
    videoPreview.currentTime = currentTime / 1000;
    await new Promise(resolve => videoPreview.addEventListener('seeked', resolve, { once: true }));
    
    try {
      const frameDescription = await processFrame(ctx);
      frameDescriptions.push(`Time ${(currentTime/1000).toFixed(1)}s: ${frameDescription}`);
      frameAnalysisDiv.textContent = frameDescriptions.join('\n\n');
    } catch (error) {
      console.error('Error processing frame:', error);
      frameDescriptions.push(`Time ${(currentTime/1000).toFixed(1)}s: Error processing frame`);
    }
    
    updateProgress(currentTime, duration);
    currentTime += FRAME_INTERVAL;
  }

  return frameDescriptions;
}

// Frame Processing Helper
async function processFrame(ctx) {
  ctx.drawImage(videoPreview, 0, 0, canvas.width, canvas.height);
  const frameBase64 = canvas.toDataURL('image/jpeg').split(',')[1];
  return await analyzeWithGemini(frameBase64, true);
}

// Progress Update
function updateProgress(current, total) {
  const progress = (current / total) * 100;
  progressBar.style.width = `${Math.min(100, progress)}%`;
  progressText.textContent = `${Math.min(100, progress.toFixed(1))}%`;
}

// Gemini API Integration
async function analyzeWithGemini(data, isImage = false) {
  const prompt = isImage 
    ? "Describe what is happening in this video frame in detail:"
    : data; // If not image, data is the text prompt

  const requestBody = {
    contents: [{
      parts: [{ text: prompt }]
    }]
  };

  // Add image data if it's an image analysis request
  if (isImage) {
    requestBody.contents[0].parts.push({
      inline_data: {
        mime_type: "image/jpeg",
        data: data
      }
    });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-8b:generateContent?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('No response from Gemini API');
    }

    const text = data.candidates[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Invalid response format from Gemini API');
    }

    return text;

  } catch (error) {
    console.error('Gemini API error:', error);
    throw new Error(`Failed to analyze with Gemini: ${error.message}`);
  }
}

// Final Summary Generation
async function generateVideoSummary(frameDescriptions, transcript) {
  const prompt = `
    Please provide a instagram algorithm friendely caption and hashtags for this video based on the following analysis:

    Frame Analysis:
    ${frameDescriptions.join('\n')}

    Audio Transcript:
    ${transcript}
  `;

  try {
    return await analyzeWithGemini(prompt);
  } catch (error) {
    console.error('Summary generation error:', error);
    return 'Error generating summary. Please check the frame analysis and transcript above.';
  }
}

// Audio Transcription
async function transcribeAudio(videoFile) {
  try {
    const audioBlob = await extractAudioFromVideo(videoFile);
    const uploadUrl = await uploadAudioToAssemblyAI(audioBlob);
    const transcript = await getTranscriptionFromAssemblyAI(uploadUrl);
    return transcript;
  } catch (error) {
    console.error('Transcription error:', error);
    return 'Error transcribing audio';
  }
}

// Audio Extraction
async function extractAudioFromVideo(videoFile) {
  return new Promise(async (resolve, reject) => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const video = document.createElement('video');
      video.src = URL.createObjectURL(videoFile);
      
      await new Promise(resolve => video.addEventListener('loadedmetadata', resolve));
      
      const stream = video.captureStream();
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) throw new Error('No audio track found');
      
      const mediaRecorder = new MediaRecorder(
        new MediaStream([audioTrack]),
        { mimeType: 'audio/webm;codecs=opus' }
      );
      
      const audioChunks = [];
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = () => resolve(new Blob(audioChunks, { type: 'audio/webm' }));
      
      mediaRecorder.start();
      video.play();
      video.onended = () => {
        mediaRecorder.stop();
        stream.getTracks().forEach(track => track.stop());
        URL.revokeObjectURL(video.src);
      };
      
    } catch (error) {
      reject(error);
    }
  });
}

// AssemblyAI Integration
async function uploadAudioToAssemblyAI(audioBlob) {
  const response = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: { 'Authorization': ASSEMBLY_API_KEY },
    body: audioBlob
  });
  
  if (!response.ok) throw new Error('Audio upload failed');
  const data = await response.json();
  return data.upload_url;
}

async function getTranscriptionFromAssemblyAI(audioUrl) {
  // Start transcription
  const response = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      'Authorization': ASSEMBLY_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      language_code: 'en'
    })
  });

  if (!response.ok) throw new Error('Transcription request failed');
  const transcriptData = await response.json();

  // Poll for results
  while (true) {
    const pollingResponse = await fetch(
      `https://api.assemblyai.com/v2/transcript/${transcriptData.id}`,
      { headers: { 'Authorization': ASSEMBLY_API_KEY } }
    );
    
    if (!pollingResponse.ok) throw new Error('Polling failed');
    const pollingData = await pollingResponse.json();
    
    if (pollingData.status === 'completed') return pollingData.text;
    if (pollingData.status === 'error') throw new Error(pollingData.error);
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// Results Update
function updateResults(summary, frameDescriptions, transcript) {
  summaryDiv.innerHTML = `<h3>Summary</h3><p>${summary}</p>`;
  frameAnalysisDiv.innerHTML = `<h3>Frame Analysis</h3><p>${frameDescriptions.join('\n\n')}</p>`;
  transcriptionDiv.innerHTML = `<h3>Transcription</h3><p>${transcript}</p>`;
  progressContainer.style.display = 'none';
}

// Error Handling
function handleError(error) {
  console.error('Processing error:', error);
  const errorMessage = document.createElement('div');
  errorMessage.className = 'error';
  errorMessage.textContent = `Error: ${error.message}`;
  document.querySelector('.container').appendChild(errorMessage);
  progressContainer.style.display = 'none';
}
