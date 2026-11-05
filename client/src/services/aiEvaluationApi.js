import api from './api'

export const runAIEvaluation = () => api.post('/ai-evaluation/run')
export const getAIEvaluationResults = (params = {}) => api.get('/ai-evaluation/results', { params })
export const getAIEvaluationResult = (id) => api.get(`/ai-evaluation/results/${id}`)
export const getAIEvaluationSummary = (params = {}) => api.get('/ai-evaluation/summary', { params })
export const getAIEvaluationHealth = () => api.get('/ai-evaluation/health')
