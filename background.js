// Background script for handling context menu and image analysis
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "analyzeVideo",
    title: "Analyze Video with Gemini",
    contexts: ["video"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "analyzeVideo") {
    analyzeVideo(info.srcUrl);
  }
});

async function analyzeVideo(videoUrl) {
  try {
    const response = await fetch(videoUrl);
    const blob = await response.blob();
    const base64 = await blobToBase64(blob);
    
    const result = await sendToGemini(base64);
    chrome.runtime.sendMessage({ type: 'analysisResult', result });
  } catch (error) {
    console.error('Error analyzing video:', error);
    chrome.runtime.sendMessage({ 
      type: 'analysisError', 
      error: error.message 
    });
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function sendToGemini(base64Data) {
  const API_KEY = 'AIzaSyBoKzwUFlqFJd4B7VK3Xg9i8D37-0wdLP0';
  const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-8b:generateContent';

  const requestBody = {
    contents: [{
      parts: [{
        text: "Analyze this video content in detail:",
      }, {
        inline_data: {
          mime_type: "video/mp4",
          data: base64Data
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
  if (!data.candidates || !data.candidates[0]) {
    throw new Error('Invalid response from Gemini API');
  }
  return data.candidates[0].content.parts[0].text;
}
