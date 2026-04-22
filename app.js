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
    statusText.innerText = 'Presented by Gurbee';
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

    // --- Advanced Core Logic ---
    if (poses && poses.length > 0) {
        const keypoints = poses[0].keypoints;
        drawSkeleton(keypoints);

        // --- Advanced pose history tracking ---
        if (!window.poseHistory) window.poseHistory = [];
        const history = window.poseHistory;
        const now = Date.now();
        // Extract key y/x for wrists, shoulders, hips
        function get(name) {
            return keypoints.find(k => k.name === name || k.part === name);
        }
        const leftWrist = get('left_wrist');
        const rightWrist = get('right_wrist');
        const leftShoulder = get('left_shoulder');
        const rightShoulder = get('right_shoulder');
        const leftHip = get('left_hip');
        const rightHip = get('right_hip');
        history.push({
            t: now,
            leftWristY: leftWrist?.y,
            rightWristY: rightWrist?.y,
            leftShoulderY: leftShoulder?.y,
            rightShoulderY: rightShoulder?.y,
            leftHipX: leftHip?.x,
            rightHipX: rightHip?.x
        });
        // Keep only last 2s
        while (history.length > 0 && now - history[0].t > 2000) history.shift();

        // Advanced ready pose: hands/arms below shoulders, and still
        function isReadyPose() {
            if (!leftWrist || !rightWrist || !leftShoulder || !rightShoulder) return false;
            // Both hands below both shoulders
            const handsBelowShoulders = leftWrist.y > leftShoulder.y && rightWrist.y > rightShoulder.y;
            // Stillness: wrists move < 10px in last 0.5s
            const t0 = now - 500;
            const recent = history.filter(h => h.t >= t0);
            if (recent.length < 2) return false;
            const maxMove = Math.max(
                ...['leftWristY', 'rightWristY'].map(k => {
                    const vals = recent.map(h => h[k]).filter(v => v != null);
                    return vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0;
                })
            );
            const still = maxMove < 10;
            return handsBelowShoulders && still;
        }

        // Advanced striking pose: hands move above->below shoulders within 1s, with hip rotation
        function isStrikingPose() {
            if (!leftWrist || !rightWrist || !leftShoulder || !rightShoulder) return false;
            const t0 = now - 1000;
            const recent = history.filter(h => h.t >= t0);
            if (recent.length < 2) return false;
            // Sequence: above -> below
            let state = 0;
            for (let h of recent) {
                const handsAbove = h.leftWristY < h.leftShoulderY && h.rightWristY < h.rightShoulderY;
                const handsBelow = h.leftWristY > h.leftShoulderY && h.rightWristY > h.rightShoulderY;
                if (state === 0 && handsAbove) state = 1;
                else if (state === 1 && handsBelow) { state = 2; break; }
            }
            if (state < 2) return false;
            // Hip rotation: check if hips moved horizontally > 30px in last 1s
            const hipMove = Math.max(
                ...['leftHipX', 'rightHipX'].map(k => {
                    const vals = recent.map(h => h[k]).filter(v => v != null);
                    return vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0;
                })
            );
            return hipMove > 30;
        }

        // --- State Machine ---
        if (currentState === AppState.IDLE && isReadyPose()) {
            currentState = AppState.READY;
            statusText.innerText = 'Ready pose detected. Waiting for strike...';
            startRecording();
        } else if (currentState === AppState.READY && isStrikingPose()) {
            currentState = AppState.SWINGING;
            statusText.innerText = 'Strike detected! Saving video...';
            stopRecordingAndSave();
        }
    } else {
        if (currentState !== AppState.IDLE) {
            currentState = AppState.IDLE;
            statusText.innerText = 'No person detected.';
        }
    }

    // Loop forever
    requestAnimationFrame(detectPoseInRealTime);
// --- Pose Detection Helpers ---


// --- Video Recording Functions ---
function startRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') return;
    recordedChunks = [];
    const stream = video.srcObject;
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    mediaRecorder.ondataavailable = function(e) {
        if (e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = function() {
        lastRecordedBlob = new Blob(recordedChunks, { type: 'video/webm' });
        // Optionally, trigger download automatically
        const url = URL.createObjectURL(lastRecordedBlob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = 'strike_video.webm';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 100);
    };
    mediaRecorder.start();
}

function stopRecordingAndSave() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
}
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