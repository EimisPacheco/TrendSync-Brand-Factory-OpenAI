import { Loader } from 'lucide-react';
import { RedisHealthCheck } from '../dashboard/RedisHealthCheck';

interface ApiCardProps {
  name: string;
  configured: boolean;
  keyPreview?: string;
  description: string;
}

function ApiCard({ name, configured, keyPreview, description }: ApiCardProps) {
  return (
    <div className="neumorphic-card p-5">
      <h4 className="font-bold text-pastel-navy mb-1">{name}</h4>
      <p className="text-sm mb-1">
        Status:{' '}
        {configured ? (
          <span className="text-green-600 font-medium">&#10003; Configured</span>
        ) : (
          <span className="text-red-500 font-medium">Not configured</span>
        )}
      </p>
      {keyPreview && (
        <p className="text-xs text-pastel-muted mb-1">
          Key: {keyPreview}
        </p>
      )}
      <p className="text-xs text-pastel-muted">{description}</p>
    </div>
  );
}

export function Settings() {
  const briaKey = import.meta.env.VITE_BRIA_API_KEY;
  const resendKey = import.meta.env.VITE_RESEND_API_KEY;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      {/* API Configuration */}
      <div>
        <h1 className="text-3xl font-bold text-pastel-navy mb-2">API Configuration</h1>
        <p className="text-pastel-text-light mb-6">Manage your API keys and service configurations.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ApiCard
            name="Bria API"
            configured={!!briaKey && briaKey.length > 5}
            keyPreview={briaKey ? briaKey.substring(0, 7) + '...' : undefined}
            description="Used for FIBO image generation"
          />
          <ApiCard
            name="Google Search"
            configured={true}
            keyPreview="Vertex AI"
            description="Used for real-time trend analysis via Gemini grounding"
          />
          <ApiCard
            name="Gemini API"
            configured={true}
            keyPreview="Vertex AI"
            description="Used for tech pack generation & adjustments"
          />
          <ApiCard
            name="Resend API"
            configured={!!resendKey && resendKey.length > 5}
            keyPreview={resendKey ? resendKey.substring(0, 7) + '...' : undefined}
            description="Used for email delivery"
          />
        </div>
      </div>

      {/* Redis Cache Status */}
      <RedisHealthCheck />
    </div>
  );
}
