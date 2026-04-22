// Get references to HTML elements
const video = document.getElementById('webcam');
const canvas = document.getElementById('output');
const ctx = canvas.getContext('2d');
const statusText = document.getElementById('status');
const loadingText = document.getElementById('loading');
const container = document.getElementById('container');
const downloadBtn = document.getElementById('download-btn');

// --- State and Configuration ---
let detector;
let poses;
let mediaRecorder;
let recordedChunks = [];
let lastRecordedBlob = null;

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;

// Application states based on your flowchart
const AppState = {
    IDLE: 'IDLE', // Not detecting a person or waiting for ready pose
    READY: 'READY', // Person is in the "ready" stance
    SWINGING: 'SWINGING', // Swing has been detected
    RECORDING: 'RECORDING' // Currently recording the swing
};
let currentState = AppState.IDLE;

// --- Main Setup Function ---
async function main() {
    // 1. Load the MoveNet model
    statusText.innerText = 'Loading PoseNet model...';
    detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet, 
        // { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING } // Use a lightweight model for speed
        { modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER }
    );

    // 2. Set up the camera
    await setupCamera();
    
    // Hide the loading text and show the video container
    loadingText.style.display = 'none';
    container.style.display = 'block';

    // 3. Start the real-time detection loop
    detectPoseInRealTime();
}

// --- Camera Setup ---
async function setupCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Browser API navigator.mediaDevices.getUserMedia not available');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
        'audio': false, // No audio needed for pose detection
        'video': {
            facingMode: 'environment', // Prefer the rear camera
            width: VIDEO_WIDTH,
            height: VIDEO_HEIGHT,
        },
    });

    video.srcObject = stream;

    return new Promise((resolve) => {
        video.onloadedmetadata = () => {
            // Set canvas dimensions to match the video
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            resolve(video);
        };
    });
}

// --- Real-time Detection Loop ---
async function detectPoseInRealTime() {
    // Estimate poses from the video feed
    poses = await detector.estimatePoses(video);

    // Clear the previous drawing
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // --- Core Logic from Flowchart ---
    if (poses && poses.length > 0) {
        const keypoints = poses[0].keypoints;
        
        // This is where we will implement the logic from your flowchart
        // isReady(keypoints); 
        // isStriking(keypoints);

        // For now, let's just draw the skeleton to show it's working
        drawSkeleton(keypoints);
    } else {
        currentState = AppState.IDLE;
        statusText.innerText = 'No person detected.';
    }

    // Loop forever
    requestAnimationFrame(detectPoseInRealTime);
}

// --- Drawing Functions for Visualization ---
function drawSkeleton(keypoints) {
    const keypointColor = 'aqua';
    const lineColor = 'lime';

    // Draw all the keypoints (joints)
    for (const keypoint of keypoints) {
        if (keypoint.score > 0.3) { // Only draw confident keypoints
            ctx.beginPath();
            ctx.arc(keypoint.x, keypoint.y, 5, 0, 2 * Math.PI);
            ctx.fillStyle = keypointColor;
            ctx.fill();
        }
    }
    
    // Draw the lines connecting the joints
    const adjacentPairs = poseDetection.util.getAdjacentPairs(poseDetection.SupportedModels.MoveNet);
    ctx.beginPath();
    for (const [i, j] of adjacentPairs) {
        const kp1 = keypoints[i];
        const kp2 = keypoints[j];
        if (kp1.score > 0.3 && kp2.score > 0.3) {
            ctx.moveTo(kp1.x, kp1.y);
            ctx.lineTo(kp2.x, kp2.y);
        }
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = lineColor;
    ctx.stroke();
}


// Start the application!
main();