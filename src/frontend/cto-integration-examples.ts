/**
 * Frontend Integration Examples for CTO Progress Tracking
 * Shows how to integrate CTO progress tracking in different frontend frameworks
 */

// ===== Socket.IO Client Integration =====

/**
 * Example 1: Vanilla JavaScript / HTML Frontend
 */
export const vanillaJSExample = `
<!DOCTYPE html>
<html>
<head>
    <title>CTO Progress Tracker</title>
    <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
</head>
<body>
    <div id="cto-tracker">
        <h2>CTO Operation Progress</h2>
        <div id="progress-bar">
            <div id="progress-fill" style="width: 0%; background: #4CAF50; height: 20px;"></div>
        </div>
        <div id="status">Waiting for operation...</div>
        <div id="details"></div>
    </div>

    <script>
        class CTOProgressTracker {
            constructor(socketUrl, userId) {
                this.socket = io(socketUrl);
                this.userId = userId;
                this.activeJobs = new Map();
                this.init();
            }

            init() {
                // Join user-specific room for personalized updates
                this.socket.emit('join_room', \`user_\${this.userId}\`);

                // Listen for CTO progress updates
                this.socket.on('worker_progress', (event) => {
                    if (event.workerType === 'cto_operation') {
                        this.handleCTOProgress(event);
                    }
                });

                // Handle connection events
                this.socket.on('connect', () => {
                    console.log('Connected to progress tracking');
                });

                this.socket.on('disconnect', () => {
                    console.log('Disconnected from progress tracking');
                });
            }

            handleCTOProgress(event) {
                const {
                    jobId,
                    tokenAddress,
                    phase,
                    totalPhases,
                    phaseTitle,
                    phaseDescription,
                    progress,
                    status,
                    details
                } = event;

                // Update progress bar
                const progressFill = document.getElementById('progress-fill');
                const statusDiv = document.getElementById('status');
                const detailsDiv = document.getElementById('details');

                progressFill.style.width = \`\${progress}%\`;
                
                // Update status with phase information
                statusDiv.innerHTML = \`
                    <strong>\${phaseTitle}</strong> (Phase \${phase}/\${totalPhases})<br>
                    \${phaseDescription}
                \`;

                // Update details
                if (details) {
                    detailsDiv.innerHTML = \`
                        <h4>Details:</h4>
                        <ul>
                            \${details.successfulBuys ? \`<li>Successful Buys: \${details.successfulBuys}</li>\` : ''}
                            \${details.failedBuys ? \`<li>Failed Buys: \${details.failedBuys}</li>\` : ''}
                            \${details.currentOperation ? \`<li>Current: \${details.currentOperation}</li>\` : ''}
                            \${details.estimatedTimeRemaining ? \`<li>ETA: \${Math.ceil(details.estimatedTimeRemaining / 1000)}s</li>\` : ''}
                        </ul>
                    \`;
                }

                // Change color based on status
                switch (status) {
                    case 'started':
                        progressFill.style.background = '#2196F3'; // Blue
                        break;
                    case 'in_progress':
                        progressFill.style.background = '#FF9800'; // Orange
                        break;
                    case 'completed':
                        progressFill.style.background = '#4CAF50'; // Green
                        break;
                    case 'failed':
                        progressFill.style.background = '#F44336'; // Red
                        break;
                }

                // Store for reference
                this.activeJobs.set(jobId, event);
            }

            // Method to track a specific CTO job
            trackCTOJob(jobId) {
                // You can implement polling fallback here if needed
                console.log(\`Tracking CTO job: \${jobId}\`);
            }
        }

        // Initialize tracker when page loads
        window.addEventListener('load', () => {
            const tracker = new CTOProgressTracker('ws://localhost:3000', 'your-user-id');
            
            // Example: Track a specific job
            // tracker.trackCTOJob('job-123');
        });
    </script>
</body>
</html>
`;

/**
 * Example 2: React Hook for CTO Progress Tracking
 */
export const reactHookExample = `
import { useState, useEffect, useCallback } from 'react';
import io from 'socket.io-client';

export const useCTOProgress = (socketUrl, userId) => {
    const [socket, setSocket] = useState(null);
    const [activeJobs, setActiveJobs] = useState(new Map());
    const [connectionStatus, setConnectionStatus] = useState('disconnected');

    useEffect(() => {
        const socketInstance = io(socketUrl);
        
        socketInstance.on('connect', () => {
            setConnectionStatus('connected');
            // Join user-specific room
            socketInstance.emit('join_room', \`user_\${userId}\`);
        });

        socketInstance.on('disconnect', () => {
            setConnectionStatus('disconnected');
        });

        socketInstance.on('worker_progress', (event) => {
            if (event.workerType === 'cto_operation') {
                setActiveJobs(prev => {
                    const newMap = new Map(prev);
                    newMap.set(event.jobId, event);
                    return newMap;
                });
            }
        });

        setSocket(socketInstance);

        return () => {
            socketInstance.disconnect();
        };
    }, [socketUrl, userId]);

    const getJobProgress = useCallback((jobId) => {
        return activeJobs.get(jobId);
    }, [activeJobs]);

    const getAllJobs = useCallback(() => {
        return Array.from(activeJobs.values());
    }, [activeJobs]);

    return {
        socket,
        activeJobs: Array.from(activeJobs.values()),
        connectionStatus,
        getJobProgress,
        getAllJobs,
    };
};

// React Component Example
export const CTOProgressTracker = ({ userId, jobId }) => {
    const { activeJobs, connectionStatus, getJobProgress } = useCTOProgress(
        'ws://localhost:3000',
        userId
    );

    const jobProgress = getJobProgress(jobId);

    if (!jobProgress) {
        return (
            <div className="cto-progress">
                <div>Waiting for CTO operation to start...</div>
                <div>Connection: {connectionStatus}</div>
            </div>
        );
    }

    const {
        phase,
        totalPhases,
        phaseTitle,
        phaseDescription,
        progress,
        status,
        details
    } = jobProgress;

    return (
        <div className="cto-progress">
            <h3>CTO Operation Progress</h3>
            
            {/* Progress Bar */}
            <div className="progress-container">
                <div 
                    className="progress-bar"
                    style={{
                        width: \`\${progress}%\`,
                        backgroundColor: getStatusColor(status),
                        height: '20px',
                        transition: 'width 0.3s ease'
                    }}
                />
            </div>
            
            {/* Status Information */}
            <div className="status-info">
                <h4>{phaseTitle} (Phase {phase}/{totalPhases})</h4>
                <p>{phaseDescription}</p>
                <p>Status: <span className={\`status-\${status}\`}>{status}</span></p>
            </div>
            
            {/* Details */}
            {details && (
                <div className="details">
                    <h5>Details:</h5>
                    <ul>
                        {details.successfulBuys && (
                            <li>Successful Buys: {details.successfulBuys}</li>
                        )}
                        {details.failedBuys && (
                            <li>Failed Buys: {details.failedBuys}</li>
                        )}
                        {details.currentOperation && (
                            <li>Current: {details.currentOperation}</li>
                        )}
                        {details.estimatedTimeRemaining && (
                            <li>ETA: {Math.ceil(details.estimatedTimeRemaining / 1000)}s</li>
                        )}
                    </ul>
                </div>
            )}
        </div>
    );
};

const getStatusColor = (status) => {
    switch (status) {
        case 'started': return '#2196F3';
        case 'in_progress': return '#FF9800';
        case 'completed': return '#4CAF50';
        case 'failed': return '#F44336';
        default: return '#9E9E9E';
    }
};
`;

/**
 * Example 3: Vue.js Composition API
 */
export const vueCompositionExample = `
<template>
  <div class="cto-progress-tracker">
    <h3>CTO Operation Progress</h3>
    
    <div v-if="!currentJob" class="waiting">
      <p>Waiting for CTO operation...</p>
      <p>Connection: {{ connectionStatus }}</p>
    </div>
    
    <div v-else class="progress-container">
      <!-- Progress Bar -->
      <div class="progress-wrapper">
        <div 
          class="progress-bar"
          :style="{
            width: currentJob.progress + '%',
            backgroundColor: getStatusColor(currentJob.status)
          }"
        ></div>
      </div>
      
      <!-- Status Info -->
      <div class="status-info">
        <h4>{{ currentJob.phaseTitle }} (Phase {{ currentJob.phase }}/{{ currentJob.totalPhases }})</h4>
        <p>{{ currentJob.phaseDescription }}</p>
        <p>Status: <span :class="\`status-\${currentJob.status}\`">{{ currentJob.status }}</span></p>
      </div>
      
      <!-- Details -->
      <div v-if="currentJob.details" class="details">
        <h5>Details:</h5>
        <ul>
          <li v-if="currentJob.details.successfulBuys">
            Successful Buys: {{ currentJob.details.successfulBuys }}
          </li>
          <li v-if="currentJob.details.failedBuys">
            Failed Buys: {{ currentJob.details.failedBuys }}
          </li>
          <li v-if="currentJob.details.currentOperation">
            Current: {{ currentJob.details.currentOperation }}
          </li>
          <li v-if="currentJob.details.estimatedTimeRemaining">
            ETA: {{ Math.ceil(currentJob.details.estimatedTimeRemaining / 1000) }}s
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import io from 'socket.io-client';

const props = defineProps({
  socketUrl: {
    type: String,
    default: 'ws://localhost:3000'
  },
  userId: {
    type: String,
    required: true
  },
  jobId: {
    type: String,
    required: true
  }
});

const socket = ref(null);
const activeJobs = ref(new Map());
const connectionStatus = ref('disconnected');

const currentJob = computed(() => {
  return activeJobs.value.get(props.jobId);
});

const initSocket = () => {
  socket.value = io(props.socketUrl);
  
  socket.value.on('connect', () => {
    connectionStatus.value = 'connected';
    socket.value.emit('join_room', \`user_\${props.userId}\`);
  });
  
  socket.value.on('disconnect', () => {
    connectionStatus.value = 'disconnected';
  });
  
  socket.value.on('worker_progress', (event) => {
    if (event.workerType === 'cto_operation') {
      activeJobs.value.set(event.jobId, event);
    }
  });
};

const getStatusColor = (status) => {
  const colors = {
    started: '#2196F3',
    in_progress: '#FF9800',
    completed: '#4CAF50',
    failed: '#F44336'
  };
  return colors[status] || '#9E9E9E';
};

onMounted(() => {
  initSocket();
});

onUnmounted(() => {
  if (socket.value) {
    socket.value.disconnect();
  }
});
</script>

<style scoped>
.progress-wrapper {
  width: 100%;
  height: 20px;
  background-color: #f0f0f0;
  border-radius: 10px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  transition: width 0.3s ease;
}

.status-started { color: #2196F3; }
.status-in_progress { color: #FF9800; }
.status-completed { color: #4CAF50; }
.status-failed { color: #F44336; }
</style>
`;

/**
 * Example 4: Polling-based Progress Tracking (for backends without Socket.IO)
 */
export const pollingExample = `
class CTOPollingTracker {
    constructor(apiBaseUrl) {
        this.apiBaseUrl = apiBaseUrl;
        this.activePolls = new Map();
        this.callbacks = new Map();
    }

    // Start tracking a CTO job with polling
    trackJob(jobId, onProgress, onCompleted, pollInterval = 2000) {
        // Stop existing poll if any
        this.stopTracking(jobId);

        const pollFunction = async () => {
            try {
                const response = await fetch(\`\${this.apiBaseUrl}/api/cto/job/\${jobId}/status\`);
                const data = await response.json();

                if (data.success) {
                    const status = data.data;
                    
                    // Call progress callback
                    if (onProgress) {
                        onProgress(status.latestProgress || status);
                    }

                    // Check if job is completed
                    if (status.status === 'completed' || status.status === 'failed') {
                        this.stopTracking(jobId);
                        
                        if (onCompleted) {
                            onCompleted(status.operationResult || status);
                        }
                        return;
                    }
                }
            } catch (error) {
                console.error(\`Polling error for job \${jobId}:\`, error);
            }

            // Schedule next poll
            const timeoutId = setTimeout(pollFunction, pollInterval);
            this.activePolls.set(jobId, timeoutId);
        };

        // Start polling immediately
        pollFunction();

        // Store callbacks for manual stop
        this.callbacks.set(jobId, { onProgress, onCompleted });
    }

    // Stop tracking a job
    stopTracking(jobId) {
        const timeoutId = this.activePolls.get(jobId);
        if (timeoutId) {
            clearTimeout(timeoutId);
            this.activePolls.delete(jobId);
        }
        this.callbacks.delete(jobId);
    }

    // Get current status (one-time check)
    async getJobStatus(jobId) {
        try {
            const response = await fetch(\`\${this.apiBaseUrl}/api/cto/job/\${jobId}/status\`);
            const data = await response.json();
            return data.success ? data.data : null;
        } catch (error) {
            console.error(\`Error fetching job status:\`, error);
            return null;
        }
    }

    // Get stats for multiple jobs
    async getJobsStats(jobIds) {
        try {
            const response = await fetch(
                \`\${this.apiBaseUrl}/api/cto/jobs/stats?jobIds=\${jobIds.join(',')}\`
            );
            const data = await response.json();
            return data.success ? data.data : null;
        } catch (error) {
            console.error(\`Error fetching jobs stats:\`, error);
            return null;
        }
    }

    // Clean up all active polls
    destroy() {
        for (const [jobId] of this.activePolls) {
            this.stopTracking(jobId);
        }
    }
}

// Usage example
const tracker = new CTOPollingTracker('http://localhost:3000');

// Track a CTO job
tracker.trackJob(
    'job-123',
    (progress) => {
        console.log('Progress:', progress);
        updateProgressBar(progress.progress);
        updateStatus(progress.phaseTitle);
    },
    (result) => {
        console.log('Completed:', result);
        showCompletionMessage(result);
    }
);
`;

/**
 * Example 5: TypeScript Types for Frontend Integration
 */
export const typescriptTypesExample = `
// CTO Progress Types for TypeScript Frontend Apps
export interface CTOProgressEvent {
    jobId: string;
    tokenAddress: string;
    userId: string;
    userChatId: number;
    socketUserId?: string;
    phase: number;
    totalPhases: number;
    phaseTitle: string;
    phaseDescription: string;
    progress: number;
    status: 'started' | 'in_progress' | 'completed' | 'failed';
    timestamp: number;
    mode: 'standard' | 'prefunded';
    platform: string;
    buyAmount: number;
    details?: {
        successfulBuys?: number;
        failedBuys?: number;
        totalSpent?: number;
        walletsUsed?: number;
        error?: string;
        transactionSignatures?: string[];
        estimatedTimeRemaining?: number;
        currentOperation?: string;
    };
}

export interface CTOOperationResult {
    jobId: string;
    success: boolean;
    successfulBuys: number;
    failedBuys: number;
    totalSpent: number;
    error?: string;
    transactionSignatures: string[];
    completedAt: number;
    duration: number;
}

export interface CTOJobStatus {
    jobId: string;
    status: 'waiting' | 'active' | 'completed' | 'failed' | 'not_found';
    progress?: number;
    data?: {
        userId: string;
        userChatId: number;
        tokenAddress: string;
        buyAmount: number;
        mode: 'standard' | 'prefunded';
        platform: string;
        socketUserId?: string;
    };
    progressEvents?: CTOProgressEvent[];
    latestProgress?: CTOProgressEvent;
    operationResult?: CTOOperationResult;
    currentPhase?: number;
    totalPhases?: number;
    currentProgress?: number;
    currentStatus?: string;
    phaseTitle?: string;
    phaseDescription?: string;
    details?: Record<string, unknown>;
}

export interface CTOProgressStats {
    total: number;
    queued: number;
    active: number;
    completed: number;
    failed: number;
    totalProgress: number;
    averageProgress: number;
}

// Frontend Service Interface
export interface CTOProgressService {
    // Socket.IO based tracking
    connectSocket(socketUrl: string, userId: string): void;
    disconnectSocket(): void;
    
    // Job tracking
    trackJob(jobId: string, callbacks: {
        onProgress?: (event: CTOProgressEvent) => void;
        onCompleted?: (result: CTOOperationResult) => void;
    }): () => void; // Returns unsubscribe function
    
    // Status fetching
    getJobStatus(jobId: string): Promise<CTOJobStatus | null>;
    getJobsStats(jobIds: string[]): Promise<CTOProgressStats | null>;
    
    // State management
    getActiveJobs(): CTOProgressEvent[];
    getJobProgress(jobId: string): CTOProgressEvent | undefined;
}
`;

export const frontendIntegrationExamples = {
  vanillaJS: vanillaJSExample,
  reactHook: reactHookExample,
  vueComposition: vueCompositionExample,
  polling: pollingExample,
  typescriptTypes: typescriptTypesExample,
};
