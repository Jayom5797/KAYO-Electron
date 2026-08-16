from typing import List, Dict, Optional, Tuple
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class RelationshipMapper:
    """
    Maps events to relationships (edges) in the behavior graph.
    
    Relationships represent causal connections between entities:
    - AUTHENTICATED_TO: User logged into Host
    - SPAWNED_BY: Process created by parent Process
    - CONNECTED_TO: Process connected to IPAddress
    - ACCESSED: Process accessed File
    - RUNS_ON: Container runs on Host
    - EXECUTED_BY: Process executed by User
    
    Security: All relationships include tenant_id for isolation
    Time complexity: O(1) per event
    """
    
    def map_relationships(self, event: Dict, entities: List[Dict]) -> List[Dict]:
        """
        Extract relationships from event and entities.
        
        Args:
            event: Normalized event dictionary
            entities: List of extracted entities
        
        Returns:
            List of relationship dictionaries with type, source, target, properties
        
        Time complexity: O(n) where n is number of entities (typically <10)
        """
        relationships = []
        event_category = event.get('event', {}).get('category')
        event_action = event.get('event', {}).get('action')
        timestamp = event.get('timestamp', int(datetime.utcnow().timestamp() * 1000000))
        event_id = event.get('event_id')
        tenant_id = event.get('tenant_id')
        
        # Build entity lookup for quick access
        entity_map = {e['type']: e for e in entities}
        
        # Authentication relationships
        if event_category == 'authentication' or 'login' in event_action.lower():
            auth_rel = self._map_authentication(event, entity_map, tenant_id, timestamp, event_id)
            if auth_rel:
                relationships.append(auth_rel)
        
        # Process relationships
        if event_category == 'process':
            process_rels = self._map_process_relationships(event, entity_map, tenant_id, timestamp, event_id)
            relationships.extend(process_rels)
        
        # Network relationships
        if event_category == 'network':
            network_rel = self._map_network_connection(event, entity_map, tenant_id, timestamp, event_id)
            if network_rel:
                relationships.append(network_rel)
        
        # File access relationships
        if event_category == 'file':
            file_rel = self._map_file_access(event, entity_map, tenant_id, timestamp, event_id)
            if file_rel:
                relationships.append(file_rel)
        
        # Container relationships
        if event_category == 'container':
            container_rel = self._map_container_relationship(event, entity_map, tenant_id, timestamp, event_id)
            if container_rel:
                relationships.append(container_rel)
        
        return relationships
    
    def _map_authentication(
        self,
        event: Dict,
        entity_map: Dict,
        tenant_id: str,
        timestamp: int,
        event_id: str
    ) -> Optional[Dict]:
        """
        Map authentication event to AUTHENTICATED_TO relationship.
        
        User -[AUTHENTICATED_TO]-> Host
        """
        user = entity_map.get('User')
        host = entity_map.get('Host')
        
        if not user or not host:
            return None
        
        return {
            'type': 'AUTHENTICATED_TO',
            'source': ('User', user['id']),
            'target': ('Host', host['id']),
            'properties': {
                'tenant_id': tenant_id,
                'timestamp': timestamp,
                'event_id': event_id,
                'method': event.get('event', {}).get('action'),
                'outcome': event.get('event', {}).get('outcome', 'unknown')
            }
        }
    
    def _map_process_relationships(
        self,
        event: Dict,
        entity_map: Dict,
        tenant_id: str,
        timestamp: int,
        event_id: str
    ) -> List[Dict]:
        """
        Map process events to relationships.
        
        Relationships:
        - Process -[SPAWNED_BY]-> ParentProcess
        - Process -[RUNS_ON]-> Host
        - Process -[EXECUTED_BY]-> User
        """
        relationships = []
        process = entity_map.get('Process')
        
        if not process:
            return relationships
        
        process_data = event.get('process', {})
        
        # Parent process relationship
        if process_data.get('parent_id'):
            relationships.append({
                'type': 'SPAWNED_BY',
                'source': ('Process', process['id']),
                'target': ('Process', process_data['parent_id']),
                'properties': {
                    'tenant_id': tenant_id,
                    'timestamp': timestamp,
                    'event_id': event_id
                }
            })
        
        # Host relationship
        host = entity_map.get('Host')
        if host:
            relationships.append({
                'type': 'RUNS_ON',
                'source': ('Process', process['id']),
                'target': ('Host', host['id']),
                'properties': {
                    'tenant_id': tenant_id,
                    'timestamp': timestamp,
                    'event_id': event_id
                }
            })
        
        # User relationship
        user = entity_map.get('User')
        if user:
            relationships.append({
                'type': 'EXECUTED_BY',
                'source': ('Process', process['id']),
                'target': ('User', user['id']),
                'properties': {
                    'tenant_id': tenant_id,
                    'timestamp': timestamp,
                    'event_id': event_id
                }
            })
        
        return relationships
    
    def _map_network_connection(
        self,
        event: Dict,
        entity_map: Dict,
        tenant_id: str,
        timestamp: int,
        event_id: str
    ) -> Optional[Dict]:
        """
        Map network event to CONNECTED_TO relationship.
        
        Process -[CONNECTED_TO]-> IPAddress
        """
        process = entity_map.get('Process')
        
        # Find destination IP entity
        dest_ip = None
        for entity in entity_map.values():
            if entity['type'] == 'IPAddress' and entity['properties'].get('port'):
                dest_ip = entity
                break
        
        if not process or not dest_ip:
            return None
        
        network_data = event.get('network', {})
        
        return {
            'type': 'CONNECTED_TO',
            'source': ('Process', process['id']),
            'target': ('IPAddress', dest_ip['id']),
            'properties': {
                'tenant_id': tenant_id,
                'timestamp': timestamp,
                'event_id': event_id,
                'dest_port': network_data.get('dest_port'),
                'protocol': network_data.get('protocol'),
                'outcome': event.get('event', {}).get('outcome', 'unknown')
            }
        }
    
    def _map_file_access(
        self,
        event: Dict,
        entity_map: Dict,
        tenant_id: str,
        timestamp: int,
        event_id: str
    ) -> Optional[Dict]:
        """
        Map file access event to ACCESSED relationship.
        
        Process -[ACCESSED]-> File
        """
        process = entity_map.get('Process')
        file_entity = entity_map.get('File')
        
        if not process or not file_entity:
            return None
        
        return {
            'type': 'ACCESSED',
            'source': ('Process', process['id']),
            'target': ('File', file_entity['id']),
            'properties': {
                'tenant_id': tenant_id,
                'timestamp': timestamp,
                'event_id': event_id,
                'action': event.get('event', {}).get('action'),
                'outcome': event.get('event', {}).get('outcome', 'unknown')
            }
        }
    
    def _map_container_relationship(
        self,
        event: Dict,
        entity_map: Dict,
        tenant_id: str,
        timestamp: int,
        event_id: str
    ) -> Optional[Dict]:
        """
        Map container event to RUNS_ON relationship.
        
        Container -[RUNS_ON]-> Host
        """
        container = entity_map.get('Container')
        host = entity_map.get('Host')
        
        if not container or not host:
            return None
        
        return {
            'type': 'RUNS_ON',
            'source': ('Container', container['id']),
            'target': ('Host', host['id']),
            'properties': {
                'tenant_id': tenant_id,
                'timestamp': timestamp,
                'event_id': event_id,
                'action': event.get('event', {}).get('action')
            }
        }
