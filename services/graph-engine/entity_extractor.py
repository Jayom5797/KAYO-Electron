import hashlib
import uuid
from typing import List, Dict, Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class EntityExtractor:
    """
    Extracts entities from normalized events for graph construction.
    
    Entities represent nodes in the behavior graph:
    - User: Human or service account
    - Process: Running process on a host
    - Host: Physical or virtual machine
    - Container: Docker/K8s container
    - Service: Network service endpoint
    - File: File system object
    - IPAddress: Network endpoint
    
    Time complexity: O(1) per event
    """
    
    def extract_entities(self, event: Dict) -> List[Dict]:
        """
        Extract all entities from an event.
        
        Args:
            event: Normalized event dictionary
        
        Returns:
            List of entity dictionaries with type, id, and properties
        
        Time complexity: O(1) - constant number of entity types
        """
        entities = []
        timestamp = event.get('timestamp', int(datetime.utcnow().timestamp() * 1000000))
        tenant_id = event.get('tenant_id')
        
        # Extract User entity
        if event.get('user'):
            user_entity = self._extract_user(event['user'], tenant_id, timestamp)
            if user_entity:
                entities.append(user_entity)
        
        # Extract Process entity
        if event.get('process'):
            process_entity = self._extract_process(event['process'], event.get('host'), tenant_id, timestamp)
            if process_entity:
                entities.append(process_entity)
        
        # Extract Host entity
        if event.get('host'):
            host_entity = self._extract_host(event['host'], tenant_id, timestamp)
            if host_entity:
                entities.append(host_entity)
        
        # Extract Container entity
        if event.get('container'):
            container_entity = self._extract_container(event['container'], tenant_id, timestamp)
            if container_entity:
                entities.append(container_entity)
        
        # Extract IPAddress entities from network data
        if event.get('network'):
            ip_entities = self._extract_ip_addresses(event['network'], tenant_id, timestamp)
            entities.extend(ip_entities)
        
        # Extract File entity
        if event.get('file'):
            file_entity = self._extract_file(event['file'], tenant_id, timestamp)
            if file_entity:
                entities.append(file_entity)
        
        return entities
    
    def _extract_user(self, user_data: Dict, tenant_id: str, timestamp: int) -> Optional[Dict]:
        """
        Extract User entity.
        
        User ID generation: Use provided ID or generate from username
        """
        if not user_data.get('name'):
            return None
        
        user_id = user_data.get('id')
        if not user_id:
            # Generate stable ID from username
            user_id = self._generate_stable_id(f"user:{tenant_id}:{user_data['name']}")
        
        return {
            'type': 'User',
            'id': user_id,
            'properties': {
                'tenant_id': tenant_id,
                'username': user_data['name'],
                'first_seen': timestamp,
                'last_seen': timestamp
            }
        }
    
    def _extract_process(self, process_data: Dict, host_data: Optional[Dict], tenant_id: str, timestamp: int) -> Optional[Dict]:
        """
        Extract Process entity.
        
        Process ID generation: hash(host_id + pid + start_time)
        This ensures processes are unique per host and lifecycle.
        """
        if not process_data.get('name'):
            return None
        
        process_id = process_data.get('id')
        if not process_id:
            # Generate stable ID from host + pid + timestamp
            host_id = host_data.get('id', 'unknown') if host_data else 'unknown'
            pid = process_data.get('pid', 0)
            # Use timestamp as proxy for process start time
            process_id = self._generate_stable_id(f"process:{host_id}:{pid}:{timestamp}")
        
        return {
            'type': 'Process',
            'id': process_id,
            'properties': {
                'tenant_id': tenant_id,
                'pid': process_data.get('pid'),
                'name': process_data['name'],
                'cmdline': process_data.get('command_line'),
                'host_id': host_data.get('id') if host_data else None,
                'parent_id': process_data.get('parent_id'),
                'first_seen': timestamp,
                'last_seen': timestamp
            }
        }
    
    def _extract_host(self, host_data: Dict, tenant_id: str, timestamp: int) -> Optional[Dict]:
        """
        Extract Host entity.
        
        Host ID generation: Use provided ID or generate from hostname
        """
        if not host_data.get('hostname'):
            return None
        
        host_id = host_data.get('id')
        if not host_id:
            # Generate stable ID from hostname
            host_id = self._generate_stable_id(f"host:{tenant_id}:{host_data['hostname']}")
        
        return {
            'type': 'Host',
            'id': host_id,
            'properties': {
                'tenant_id': tenant_id,
                'hostname': host_data['hostname'],
                'ip_address': host_data.get('ip'),
                'first_seen': timestamp,
                'last_seen': timestamp
            }
        }
    
    def _extract_container(self, container_data: Dict, tenant_id: str, timestamp: int) -> Optional[Dict]:
        """
        Extract Container entity.
        
        Container ID: Use Docker/K8s container ID directly
        """
        if not container_data.get('id'):
            return None
        
        return {
            'type': 'Container',
            'id': container_data['id'],
            'properties': {
                'tenant_id': tenant_id,
                'name': container_data.get('name'),
                'image': container_data.get('image'),
                'first_seen': timestamp,
                'last_seen': timestamp
            }
        }
    
    def _extract_ip_addresses(self, network_data: Dict, tenant_id: str, timestamp: int) -> List[Dict]:
        """
        Extract IPAddress entities from network connections.
        
        Creates entities for both source and destination IPs.
        """
        entities = []
        
        if network_data.get('source_ip'):
            entities.append({
                'type': 'IPAddress',
                'id': self._generate_stable_id(f"ip:{network_data['source_ip']}"),
                'properties': {
                    'tenant_id': tenant_id,
                    'address': network_data['source_ip'],
                    'first_seen': timestamp,
                    'last_seen': timestamp
                }
            })
        
        if network_data.get('dest_ip'):
            entities.append({
                'type': 'IPAddress',
                'id': self._generate_stable_id(f"ip:{network_data['dest_ip']}"),
                'properties': {
                    'tenant_id': tenant_id,
                    'address': network_data['dest_ip'],
                    'port': network_data.get('dest_port'),
                    'first_seen': timestamp,
                    'last_seen': timestamp
                }
            })
        
        return entities
    
    def _extract_file(self, file_data: Dict, tenant_id: str, timestamp: int) -> Optional[Dict]:
        """
        Extract File entity.
        
        File ID generation: Use hash if available, otherwise path-based ID
        """
        if not file_data.get('path'):
            return None
        
        file_id = file_data.get('hash')
        if not file_id:
            # Generate stable ID from path
            file_id = self._generate_stable_id(f"file:{tenant_id}:{file_data['path']}")
        
        return {
            'type': 'File',
            'id': file_id,
            'properties': {
                'tenant_id': tenant_id,
                'path': file_data['path'],
                'hash': file_data.get('hash'),
                'first_seen': timestamp,
                'last_seen': timestamp
            }
        }
    
    @staticmethod
    def _generate_stable_id(key: str) -> str:
        """
        Generate stable UUID from string key using SHA256 hash.
        
        Args:
            key: String to hash
        
        Returns:
            UUID string
        
        Security: Uses SHA256 for collision resistance
        Time complexity: O(1)
        """
        hash_bytes = hashlib.sha256(key.encode()).digest()
        return str(uuid.UUID(bytes=hash_bytes[:16]))
