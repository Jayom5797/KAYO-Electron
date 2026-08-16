from neo4j import GraphDatabase
from typing import List, Dict, Optional, Tuple
import logging

logger = logging.getLogger(__name__)


class AttackPathReconstructor:
    """
    Reconstructs attack paths by traversing the behavior graph.
    
    Given a detected incident, traces back to find:
    - Initial access point (root cause)
    - Complete attack chain (sequence of actions)
    - Affected entities (users, hosts, processes)
    - Confidence score based on relationship strength
    
    Algorithm:
    1. Start from incident entities
    2. Traverse graph backwards (follow incoming edges)
    3. Build temporal sequence of events
    4. Calculate confidence scores
    5. Generate attack narrative
    
    Time complexity: O(V + E) where V is vertices, E is edges in subgraph
    """
    
    def __init__(self, driver: GraphDatabase.driver, database: str):
        """
        Initialize reconstructor.
        
        Args:
            driver: Neo4j driver for tenant database
            database: Tenant database name
        """
        self.driver = driver
        self.database = database
    
    def reconstruct_attack_path(
        self,
        incident_data: Dict,
        max_depth: int = 10
    ) -> Dict:
        """
        Reconstruct complete attack path from incident.
        
        Args:
            incident_data: Incident details with graph snapshot
            max_depth: Maximum traversal depth
        
        Returns:
            Dictionary with attack path, timeline, and confidence
        
        Time complexity: O(V + E) for graph traversal
        """
        try:
            with self.driver.session(database=self.database) as session:
                # Extract starting entities from incident
                matches = incident_data.get('graph_snapshot', {}).get('matches', [])
                if not matches:
                    return self._empty_result()
                
                # Find root cause (initial access)
                root_entities = self._find_root_cause(session, matches, max_depth)
                
                # Build attack chain
                attack_chain = self._build_attack_chain(session, root_entities, matches)
                
                # Calculate confidence score
                confidence = self._calculate_confidence(attack_chain)
                
                # Generate timeline
                timeline = self._generate_timeline(attack_chain)
                
                return {
                    'root_cause': root_entities,
                    'attack_chain': attack_chain,
                    'timeline': timeline,
                    'confidence_score': confidence,
                    'affected_entities': self._extract_affected_entities(attack_chain)
                }
        
        except Exception as e:
            logger.error(f"Failed to reconstruct attack path: {e}", exc_info=True)
            return self._empty_result()
    
    def _find_root_cause(
        self,
        session,
        matches: List[Dict],
        max_depth: int
    ) -> List[Dict]:
        """
        Find initial access point by traversing backwards.
        
        Strategy:
        - Start from detected entities
        - Follow SPAWNED_BY, AUTHENTICATED_TO relationships backwards
        - Find entities with no incoming edges (root)
        
        Args:
            session: Neo4j session
            matches: Detection matches
            max_depth: Maximum traversal depth
        
        Returns:
            List of root entities
        
        Time complexity: O(V + E) for BFS traversal
        """
        root_entities = []
        
        for match in matches[:5]:  # Limit to first 5 matches
            # Extract entity IDs from match
            entity_ids = self._extract_entity_ids(match)
            
            for entity_id in entity_ids:
                # Traverse backwards to find root
                query = """
                MATCH path = (root)-[*0..{max_depth}]->(target)
                WHERE target.id = $entity_id
                  AND NOT (root)<-[:SPAWNED_BY|AUTHENTICATED_TO]-()
                RETURN root, length(path) as depth
                ORDER BY depth DESC
                LIMIT 1
                """.replace('{max_depth}', str(max_depth))
                
                result = session.run(query, entity_id=entity_id)
                record = result.single()
                
                if record:
                    root = dict(record['root'])
                    root['depth'] = record['depth']
                    root_entities.append(root)
        
        return root_entities
    
    def _build_attack_chain(
        self,
        session,
        root_entities: List[Dict],
        target_matches: List[Dict]
    ) -> List[Dict]:
        """
        Build complete attack chain from root to target.
        
        Args:
            session: Neo4j session
            root_entities: Initial access points
            target_matches: Detected incident entities
        
        Returns:
            List of attack steps with relationships
        
        Time complexity: O(V + E) for path finding
        """
        attack_chain = []
        
        if not root_entities:
            return attack_chain
        
        # Use first root entity
        root = root_entities[0]
        root_id = root.get('id')
        
        # Extract target entity IDs
        target_ids = []
        for match in target_matches[:5]:
            target_ids.extend(self._extract_entity_ids(match))
        
        if not target_ids:
            return attack_chain
        
        # Find shortest path from root to each target
        for target_id in target_ids[:3]:  # Limit to 3 targets
            query = """
            MATCH path = shortestPath((root)-[*..15]->(target))
            WHERE root.id = $root_id AND target.id = $target_id
            RETURN [node in nodes(path) | node] as nodes,
                   [rel in relationships(path) | rel] as relationships
            """
            
            result = session.run(query, root_id=root_id, target_id=target_id)
            record = result.single()
            
            if record:
                nodes = [dict(node) for node in record['nodes']]
                relationships = [dict(rel) for rel in record['relationships']]
                
                # Build step-by-step chain
                for i, rel in enumerate(relationships):
                    step = {
                        'step_number': i + 1,
                        'source': nodes[i],
                        'relationship': rel,
                        'target': nodes[i + 1],
                        'timestamp': rel.get('timestamp'),
                        'event_id': rel.get('event_id')
                    }
                    attack_chain.append(step)
        
        # Sort by timestamp
        attack_chain.sort(key=lambda x: x.get('timestamp', 0))
        
        # Renumber steps
        for i, step in enumerate(attack_chain):
            step['step_number'] = i + 1
        
        return attack_chain
    
    def _calculate_confidence(self, attack_chain: List[Dict]) -> float:
        """
        Calculate confidence score for attack path.
        
        Factors:
        - Chain completeness (fewer gaps = higher confidence)
        - Temporal consistency (events in order)
        - Relationship strength (direct vs inferred)
        
        Args:
            attack_chain: List of attack steps
        
        Returns:
            Confidence score (0.0 to 1.0)
        
        Time complexity: O(n) where n is chain length
        """
        if not attack_chain:
            return 0.0
        
        score = 1.0
        
        # Penalize for gaps in chain
        if len(attack_chain) < 3:
            score *= 0.7
        
        # Check temporal consistency
        timestamps = [step.get('timestamp', 0) for step in attack_chain]
        if timestamps != sorted(timestamps):
            score *= 0.8
        
        # Check for missing event IDs (inferred relationships)
        missing_events = sum(1 for step in attack_chain if not step.get('event_id'))
        if missing_events > 0:
            score *= (1.0 - (missing_events / len(attack_chain)) * 0.3)
        
        return round(score, 2)
    
    def _generate_timeline(self, attack_chain: List[Dict]) -> List[Dict]:
        """
        Generate human-readable timeline from attack chain.
        
        Args:
            attack_chain: List of attack steps
        
        Returns:
            List of timeline events
        
        Time complexity: O(n)
        """
        timeline = []
        
        for step in attack_chain:
            source = step['source']
            target = step['target']
            rel = step['relationship']
            
            # Generate description based on relationship type
            rel_type = rel.get('type', 'UNKNOWN')
            
            if rel_type == 'AUTHENTICATED_TO':
                description = f"User {source.get('username', 'unknown')} authenticated to {target.get('hostname', 'host')}"
            elif rel_type == 'SPAWNED_BY':
                description = f"Process {target.get('name', 'unknown')} spawned by {source.get('name', 'parent')}"
            elif rel_type == 'CONNECTED_TO':
                description = f"Process {source.get('name', 'unknown')} connected to {target.get('address', 'IP')}:{rel.get('dest_port', '?')}"
            elif rel_type == 'ACCESSED':
                description = f"Process {source.get('name', 'unknown')} accessed file {target.get('path', 'unknown')}"
            else:
                description = f"{source.get('name', 'Entity')} {rel_type} {target.get('name', 'Entity')}"
            
            timeline.append({
                'step': step['step_number'],
                'timestamp': step.get('timestamp'),
                'description': description,
                'entities': {
                    'source': source.get('name') or source.get('username') or source.get('hostname'),
                    'target': target.get('name') or target.get('address') or target.get('path')
                }
            })
        
        return timeline
    
    def _extract_affected_entities(self, attack_chain: List[Dict]) -> Dict:
        """
        Extract all affected entities from attack chain.
        
        Args:
            attack_chain: List of attack steps
        
        Returns:
            Dictionary of entity types to entity lists
        
        Time complexity: O(n)
        """
        entities = {
            'users': set(),
            'hosts': set(),
            'processes': set(),
            'files': set(),
            'ip_addresses': set()
        }
        
        for step in attack_chain:
            for node in [step['source'], step['target']]:
                node_type = node.get('labels', ['Unknown'])[0] if 'labels' in node else 'Unknown'
                
                if node_type == 'User':
                    entities['users'].add(node.get('username', 'unknown'))
                elif node_type == 'Host':
                    entities['hosts'].add(node.get('hostname', 'unknown'))
                elif node_type == 'Process':
                    entities['processes'].add(node.get('name', 'unknown'))
                elif node_type == 'File':
                    entities['files'].add(node.get('path', 'unknown'))
                elif node_type == 'IPAddress':
                    entities['ip_addresses'].add(node.get('address', 'unknown'))
        
        # Convert sets to lists
        return {k: list(v) for k, v in entities.items()}
    
    @staticmethod
    def _extract_entity_ids(match: Dict) -> List[str]:
        """
        Extract entity IDs from detection match.
        
        Args:
            match: Detection match dictionary
        
        Returns:
            List of entity IDs
        
        Time complexity: O(n) where n is fields in match
        """
        entity_ids = []
        
        # Look for ID fields in match
        for key, value in match.items():
            if key.endswith('_id') and value:
                entity_ids.append(value)
        
        return entity_ids
    
    @staticmethod
    def _empty_result() -> Dict:
        """Return empty result structure"""
        return {
            'root_cause': [],
            'attack_chain': [],
            'timeline': [],
            'confidence_score': 0.0,
            'affected_entities': {
                'users': [],
                'hosts': [],
                'processes': [],
                'files': [],
                'ip_addresses': []
            }
        }
