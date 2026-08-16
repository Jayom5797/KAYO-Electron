from kafka import KafkaProducer
import json
import logging
from typing import Dict, Any
from datetime import datetime

logger = logging.getLogger(__name__)


class DeadLetterQueue:
    """
    Dead letter queue for failed event processing.
    
    Architecture:
    - Publishes failed events to dedicated Kafka topic
    - Includes error metadata for debugging
    - Enables manual reprocessing or analysis
    
    Security: Includes tenant_id for isolation
    Time complexity: O(1) per failed event
    """
    
    def __init__(self, bootstrap_servers: str):
        """Initialize DLQ producer"""
        self.producer = KafkaProducer(
            bootstrap_servers=bootstrap_servers,
            value_serializer=lambda v: json.dumps(v).encode('utf-8')
        )
        self.dlq_topic = 'telemetry.dead_letter'
    
    def send(
        self,
        event: Dict[str, Any],
        error: Exception,
        processing_stage: str,
        tenant_id: str
    ):
        """
        Send failed event to DLQ.
        
        Args:
            event: Original event that failed
            error: Exception that occurred
            processing_stage: Stage where failure occurred
            tenant_id: Tenant UUID
        
        Security: Includes tenant_id for isolation
        Time complexity: O(1)
        """
        dlq_message = {
            'original_event': event,
            'error': {
                'type': type(error).__name__,
                'message': str(error),
                'stage': processing_stage
            },
            'metadata': {
                'tenant_id': tenant_id,
                'failed_at': datetime.utcnow().isoformat(),
                'retry_count': event.get('_retry_count', 0)
            }
        }
        
        try:
            self.producer.send(self.dlq_topic, value=dlq_message)
            logger.warning(
                f"Sent event to DLQ: tenant={tenant_id}, "
                f"stage={processing_stage}, error={type(error).__name__}"
            )
        except Exception as e:
            logger.error(f"Failed to send to DLQ: {e}")
    
    def close(self):
        """Close producer"""
        self.producer.close()
