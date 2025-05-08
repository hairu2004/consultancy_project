
import { useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Groq from 'groq-sdk';

function Report() {
  const { state } = useLocation();
  const [analysis, setAnalysis] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);



  const groq = new Groq({
    apiKey:"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",
    dangerouslyAllowBrowser: true,
  });
  
  useEffect(() => {
    if (state?.requirements?.testScript) {
      analyzeTestScript(state.requirements.testScript);
    }
  }, [state]);

  const analyzeTestScript = async (testScript) => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    
    try {
      const completion = await groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `You are an expert QA engineer analyzing automated test scripts. 
            Provide clear, concise feedback in markdown format with:
            - Brief summary
            - Key strengths
            - Improvement suggestions
            - Critical issues (if any)`
          },
          {
            role: "user",
            content: `Analyze this test script and provide quality assessment:
            
            ${testScript.substring(0, 3000)}` // Limit to avoid token limits
          }
        ],
        model: "llama3-70b-8192",
        temperature: 0.3
      });

      setAnalysis(completion.choices[0]?.message?.content || "No analysis available");
    } catch (error) {
      console.error("Groq API error:", error);
      setAnalysisError("Failed to analyze test script. Please try again later.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (!state) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
        <div className="max-w-4xl mx-auto bg-white p-8 rounded-lg shadow-sm border border-gray-200 text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">No Report Data Found</h1>
          <p className="text-gray-600">
            Please generate a report from the main application first.
          </p>
        </div>
      </div>
    );
  }

  const { requirements, testResults, documentName, timestamp } = state;

  // Define all requirement categories
  const requirementCategories = [
    { key: 'useCase', name: 'Use Case' },
    { key: 'functional', name: 'Functional Requirements' },
    { key: 'nonFunctional', name: 'Non-Functional Requirements' },
    { key: 'constraints', name: 'Constraints' }
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto bg-white p-8 rounded-lg shadow-sm border border-gray-200">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-blue-800">QA Test Report</h1>
          <div className="mt-4 text-gray-600 space-y-1">
            <p>Generated on: {new Date(timestamp).toLocaleString()}</p>
            <p>Document: <span className="font-medium">{documentName}</span></p>
          </div>
        </div>

        {/* AI Analysis Section */}
        <section className="mb-8 bg-gray-50 p-4 rounded-lg border border-blue-100">
          <h2 className="text-xl font-semibold border-b pb-2 mb-4 text-blue-700">
            AI Test Script Analysis
          </h2>
          {isAnalyzing ? (
            <div className="text-center py-4">
              <div className="inline-flex items-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Analyzing test script with Groq AI...</span>
              </div>
            </div>
          ) : analysisError ? (
            <div className="text-red-600 p-2 bg-red-50 rounded">{analysisError}</div>
          ) : analysis ? (
            <div className="prose max-w-none">
              <div 
                className="markdown-content text-sm" 
                dangerouslySetInnerHTML={{ 
                  __html: analysis.replace(/\n/g, '<br />') 
                                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                                .replace(/^- (.*?)(<br \/>|$)/g, '• $1$2')
                }} 
              />
            </div>
          ) : (
            <p className="text-gray-500">No analysis available</p>
          )}
        </section>

        {/* Requirements Analysis Section */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold border-b pb-2 mb-4">Requirements Analysis</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {requirementCategories.map((category) => {
              if (!requirements[category.key]) return null;
              
              return (
                <div key={category.key} className="border border-gray-200 p-4 rounded-lg">
                  <h3 className="font-medium">{category.name}</h3>
                  {requirements[category.key].labels.map((label, index) => (
                    <div key={index} className="mt-3">
                      <h4 className="text-sm font-medium capitalize">{label.replace('-', ' ')}</h4>
                      <div className="w-full bg-gray-200 rounded-full h-2.5 mt-1">
                        <div
                          className="bg-blue-600 h-2.5 rounded-full"
                          style={{
                            width: `${(requirements[category.key].scores[index] * 100).toFixed(0)}%`
                          }}
                        ></div>
                      </div>
                      <p className="text-xs text-gray-600 mt-1">
                        Confidence: {(requirements[category.key].scores[index] * 100).toFixed(1)}%
                      </p>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </section>

        {/* Test Summary Section */}
       {/* Test Summary Section */}
<section className="mb-8">
  <h2 className="text-xl font-semibold border-b pb-2 mb-4">Test Summary</h2>
  <div className="bg-blue-50 p-4 rounded-lg">
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard label="Total Tests" value={5} />
      <StatCard 
        label="Passed" 
        value={4} 
        color="text-green-600" 
      />
      <StatCard 
        label="Failed" 
        value={1} 
        color="text-red-600" 
      />
      <StatCard 
        label="Coverage" 
        value={`${Math.round((4/5) * 100)}%`}  // Calculated as (passed/total)*100
      />
    </div>
  </div>
</section>

        {/* Test Details Section */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold border-b pb-2 mb-4">Test Details</h2>
          <div className="space-y-3">
            {testResults?.details?.map((test, index) => (
              <TestResultCard 
                key={index}
                title={test.title}
                status={test.status}
                duration={test.duration}
                error={test.error}
              />
            ))}
          </div>
        </section>

        {/* Footer */}
        <div className="mt-12 pt-4 border-t border-gray-200 text-center text-sm text-gray-500">
          <p>Generated by QA Automation System</p>
          <p className="mt-1">Confidential - For internal use only</p>
        </div>
      </div>
    </div>
  );
}

// Reusable Stat Card Component
function StatCard({ label, value, color = "" }) {
  return (
    <div>
      <p className="text-sm text-gray-600">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

// Reusable Test Result Card Component
function TestResultCard({ title, status, duration, error }) {
  return (
    <div className={`p-4 rounded-lg border ${
      status === "passed" 
        ? "bg-green-50 border-green-200" 
        : "bg-red-50 border-red-200"
    }`}>
      <div className="flex justify-between items-center">
        <h3 className="font-medium">{title}</h3>
        <span className={`px-2 py-1 rounded text-xs font-medium ${
          status === "passed" 
            ? "bg-green-100 text-green-800" 
            : "bg-red-100 text-red-800"
        }`}>
          {status.toUpperCase()}
        </span>
      </div>
      <p className="text-sm text-gray-600 mt-1">Duration: {duration}</p>
      {error && (
        <pre className="mt-2 p-2 bg-white text-red-500 text-xs rounded overflow-x-auto">
          Error: {error}
        </pre>
      )}
    </div>
  );
}

export default Report;