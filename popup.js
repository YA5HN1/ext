document.getElementById('videoInput').addEventListener('change', handleVideoSelect);

async function handleVideoSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const video = document.getElementById('videoPreview');
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const progress = document.querySelector('.progress');
  const progressText = document.getElementById('progressText');
  const resultDiv = document.getElementById('result');
  const transcriptionDiv = document.getElementById('transcription');

  // Show video preview and progress
  video.style.display = 'block';
  video.src = URL.createObjectURL(file);
  progress.style.display = 'block';
  resultDiv.textContent = 'Analyzing video...';
  transcriptionDiv.textContent = 'Preparing transcription...';

  try {
    // Start audio transcription
    const transcriptionPromise = transcribeAudio(file);

    // Wait for video metadata to load
    await new Promise(resolve => video.addEventListener('loadedmetadata', resolve));

    // Set canvas dimensions
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Process video frames
    const frameInterval = 3000; // 3 seconds
    const duration = video.duration * 1000;
    let currentTime = 0;
    const frameDescriptions = [];

    // Capture frames
    while (currentTime < duration) {
      video.currentTime = currentTime / 1000;
      await new Promise(resolve => video.addEventListener('seeked', resolve, { once: true }));
      
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frameBase64 = canvas.toDataURL('image/jpeg').split(',')[1];
      
      const frameDescription = await sendToGemini(frameBase64);
      frameDescriptions.push(`Time ${(currentTime/1000).toFixed(1)}s: ${frameDescription}`);
      resultDiv.textContent = frameDescriptions.join('\n\n');

      currentTime += frameInterval;
      const progress = (currentTime / duration) * 100;
      progressText.textContent = `${Math.min(100, progress.toFixed(1))}%`;
    }

    // Wait for transcription to complete
    const transcript = await transcriptionPromise;
    transcriptionDiv.textContent = transcript;
    
    progress.style.display = 'none';

  } catch (error) {
    console.error('Error processing video:', error);
    resultDiv.textContent = 'Error: ' + error.message;
    progress.style.display = 'none';
  }
}

async function sendToGemini(base64Image) {
  const API_KEY = 'AIzaSyBoKzwUFlqFJd4B7VK3Xg9i8D37-0wdLP0';
  const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-8b:generateContent';

  const requestBody = {
    contents: [{
      parts: [{
        text: "Describe what's happening in this video frame:",
      }, {
        inline_data: {
          mime_type: "image/jpeg",
          data: base64Image
        }
      }]
    }]
  };

  const response = await fetch(`${API_URL}?key=${API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody)
  });

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

async function transcribeAudio(videoFile) {
  const transcriptionDiv = document.getElementById('transcription');
  const API_KEY = '1860e6a93d4a41479ba55e05faa7891d'; // Your AssemblyAI API key
  
  try {
    transcriptionDiv.textContent = 'Extracting audio...';
    const audioBlob = await extractAudioFromVideo(videoFile);
    
    transcriptionDiv.textContent = 'Uploading audio for transcription...';
    
    // First, upload the audio file
    const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: {
        'Authorization': API_KEY
      },
      body: audioBlob
    });
    
    if (!uploadResponse.ok) {
      throw new Error(`Upload failed: ${uploadResponse.statusText}`);
    }
    
    const uploadData = await uploadResponse.json();
    const audioUrl = uploadData.upload_url;
    
    // Then, start the transcription
    const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        'Authorization': API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        audio_url: audioUrl,
        language_code: 'en'
      })
    });
    
    if (!transcriptResponse.ok) {
      throw new Error(`Transcription request failed: ${transcriptResponse.statusText}`);
    }
    
    const transcriptData = await transcriptResponse.json();
    const transcriptId = transcriptData.id;
    
    // Poll for transcription completion
    transcriptionDiv.textContent = 'Transcribing audio...';
    while (true) {
      const pollingResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: {
          'Authorization': API_KEY
        }
      });
      
      if (!pollingResponse.ok) {
        throw new Error(`Polling failed: ${pollingResponse.statusText}`);
      }
      
      const pollingData = await pollingResponse.json();
      
      if (pollingData.status === 'completed') {
        return pollingData.text;
      } else if (pollingData.status === 'error') {
        throw new Error(`Transcription failed: ${pollingData.error}`);
      }
      
      // Wait 2 seconds before polling again
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
  } catch (error) {
    console.error('Transcription error:', error);
    throw new Error('Failed to transcribe audio: ' + error.message);
  }
}

async function extractAudioFromVideo(videoFile) {
  return new Promise(async (resolve, reject) => {
    try {
      // Create audio context
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const videoUrl = URL.createObjectURL(videoFile);
      const video = document.createElement('video');
      video.src = videoUrl;
      
      // Wait for video metadata to load
      await new Promise(resolve => video.addEventListener('loadedmetadata', resolve));
      
      // Create media stream source
      const stream = video.captureStream();
      const audioTracks = stream.getAudioTracks();
      
      if (audioTracks.length === 0) {
        throw new Error('No audio track found in video');
      }
      
      // Create media recorder for audio only
      const mediaStream = new MediaStream([audioTracks[0]]);
      const mediaRecorder = new MediaRecorder(mediaStream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      const audioChunks = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        resolve(audioBlob);
      };
      
      // Start recording and playing video
      mediaRecorder.start();
      video.currentTime = 0;
      await video.play();
      
      // Stop when video ends
      video.onended = () => {
        mediaRecorder.stop();
        stream.getTracks().forEach(track => track.stop());
        video.remove();
        URL.revokeObjectURL(videoUrl);
      };
      
    } catch (error) {
      reject(error);
    }
  });
} 