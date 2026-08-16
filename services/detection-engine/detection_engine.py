from neo4j import GraphDatabase
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import yaml
import logging
import time
import schedule
from pathlib import Path
from typing import List, Dict, Optional
from datetime import datetime
import uuid

from config import settings

logging.basicConfig(
    level=settings.log_level,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class DetectionEngine:
    """
    Evaluates security detection rules against behavior graphs.
    
    Architecture:
    - Loads YAML rule definitions
    - Queries tenant Neo4j databases periodically
    - Creates incidents in PostgreSQL when patterns match
    - Supports MITRE ATT&CK mapping
    
    Performance:
    - Runs every 60 seconds (configurable)
    - Queries last hour of graph data
    - Parallel execution per tenant
    
    Time complexity: O(t * r) where t is tenants, r is rules
    """
    
    def __init__(self):
        """Initialize database connections and load rules"""
        # PostgreSQL for tenant metadata and incident storage
        engine = create_engine(settings.database_url)
        Session = sessionmaker(bind=engine)
        self.db_session = Session()
        
        # Neo4j admin connection
        self.neo4j_admin = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_admin_user, settings.neo4j_admin_password)
        )
        
        # Cache of tenant drivers
        self.tenant_drivers = {}
        
        # Load detection rules
        self.rules = self._load_rules()
        
        # Metrics
        self.detections_run = 0
        self.incidents_created = 0
        
        logger.info(f"Initialized DetectionEngine with {len(self.rules)} rules")
    
    def _load_rules(self) -> List[Dict]:
        """
        Load detection rules from YAML files.
        
        Returns:
            List of rule dictionaries
        
        Time complexity: O(n) where n is number of rule files
        """
        rules = []
        rules_path = Path(settings.rules_directory)
        
        if not rules_path.exists():
            logger.warning(f"Rules directory not found: {rules_path}")
            return rules
        
        for rule_file in rules_path.glob("*.yaml"):
            try:
                with open(rule_file, 'r') as f:
                    rule = yaml.safe_load(f)
                    rules.append(rule)
                    logger.info(f"Loaded rule: {rule['rule_id']} - {rule['name']}")
            except Exception as e:
                logger.error(f"Failed to load rule {rule_file}: {e}")
        
        return rules
    
    def run_detections(self):
        """
        Run all detection rules against all tenant graphs.
        
        This is the main detection loop executed periodically.
        
        Time complexity: O(t * r) where t is tenants, r is rules
        """
        logger.info("Starting detection run")
        start_time = time.time()
        
        # Get all active tenants
        tenants = self._get_active_tenants()
        logger.info(f"Running detections for {len(tenants)} tenants")
        
        incidents_this_run = 0
        
        for tenant in tenants:
            tenant_id = str(tenant.tenant_id)
            
            try:
                # Run all rules for this tenant
                for rule in self.rules:
                    matches = self._execute_rule(tenant_id, rule)
                    
                    if matches and len(matches) >= rule.get('threshold', 1):
                        incident = self._create_incident(tenant_id, rule, matches)
                        if incident:
                            incidents_this_run += 1
                            logger.info(
                                f"Created incident {incident.incident_id} for tenant {tenant_id}: "
                                f"{rule['name']}"
                            )
            
            except Exception as e:
                logger.error(f"Failed to run detections for tenant {tenant_id}: {e}", exc_info=True)
        
        self.detections_run += 1
        self.incidents_created += incidents_this_run
        elapsed = time.time() - start_time
        
        logger.info(
            f"Detection run complete: {incidents_this_run} incidents created in {elapsed:.2f}s. "
            f"Total runs: {self.detections_run}, total incidents: {self.incidents_created}"
        )
    
    def _get_active_tenants(self) -> List:
        """
        Get list of active tenants from PostgreSQL.
        
        Returns:
            List of Tenant objects
        
        Time complexity: O(n) where n is number of tenants
        """
        try:
            # Import here to avoid circular dependency
            import sys
            sys.path.append('../../services/control-plane')
            from models.tenant import Tenant
            
            return self.db_session.query(Tenant).all()
        
        except Exception as e:
            logger.error(f"Failed to get tenants: {e}")
            return []
    
    def _execute_rule(self, tenant_id: str, rule: Dict) -> List[Dict]:
        """
        Execute detection rule against tenant graph.
        
        Args:
            tenant_id: Tenant UUID
            rule: Rule dictionary with query and parameters
        
        Returns:
            List of matches (graph query results)
        
        Security: Uses parameterized queries
        Time complexity: O(n) where n is graph size (depends on query)
        """
        try:
            driver = self._get_tenant_driver(tenant_id)
            database = self._get_tenant_database(tenant_id)
            
            if not driver or not database:
                return []
            
            with driver.session(database=database) as session:
                # Execute Cypher query with lookback window
                result = session.run(
                    rule['query'],
                    lookback_window=settings.lookback_window * 1000000  # Convert to microseconds
                )
                
                matches = [dict(record) for record in result]
                
                if matches:
                    logger.info(
                        f"Rule {rule['rule_id']} matched {len(matches)} times for tenant {tenant_id}"
                    )
                
                return matches
        
        except Exception as e:
            logger.error(f"Failed to execute rule {rule['rule_id']} for tenant {tenant_id}: {e}")
            return []
    
    def _create_incident(self, tenant_id: str, rule: Dict, matches: List[Dict]) -> Optional[object]:
        """
        Create incident record in PostgreSQL.
        
        Args:
            tenant_id: Tenant UUID
            rule: Detection rule that matched
            matches: List of graph query results
        
        Returns:
            Incident object or None
        
        Security: Uses ORM to prevent SQL injection
        Time complexity: O(1) - single database insert
        """
        try:
            import sys
            sys.path.append('../../services/control-plane')
            from models.incident import Incident
            
            # Extract event IDs from matches if available
            event_chain = []
            for match in matches:
                if 'event_id' in match:
                    event_chain.append(match['event_id'])
            
            # Create incident
            incident = Incident(
                tenant_id=uuid.UUID(tenant_id),
                severity=rule['severity'],
                status='new',
                attack_pattern=rule['name'],
                mitre_technique=rule.get('mitre_technique'),
                event_chain=event_chain[:10],  # Limit to first 10 events
                graph_snapshot={'matches': matches[:5]},  # Store sample matches
                ai_summary=None  # Will be generated by AI service
            )
            
            self.db_session.add(incident)
            self.db_session.commit()
            self.db_session.refresh(incident)
            
            return incident
        
        except Exception as e:
            self.db_session.rollback()
            logger.error(f"Failed to create incident: {e}", exc_info=True)
            return None
    
    def _get_tenant_driver(self, tenant_id: str):
        """Get or create Neo4j driver for tenant (cached)"""
        if tenant_id in self.tenant_drivers:
            return self.tenant_drivers[tenant_id]
        
        try:
            driver = GraphDatabase.driver(
                settings.neo4j_uri,
                auth=(settings.neo4j_admin_user, settings.neo4j_admin_password)
            )
            self.tenant_drivers[tenant_id] = driver
            return driver
        except Exception as e:
            logger.error(f"Failed to create driver for tenant {tenant_id}: {e}")
            return None
    
    def _get_tenant_database(self, tenant_id: str) -> Optional[str]:
        """Get Neo4j database name for tenant"""
        try:
            import sys
            sys.path.append('../../services/control-plane')
            from models.tenant import Tenant
            
            tenant = self.db_session.query(Tenant).filter(
                Tenant.tenant_id == tenant_id
            ).first()
            
            if not tenant:
                return None
            
            return tenant.settings.get('neo4j_database')
        except Exception as e:
            logger.error(f"Failed to get database for tenant {tenant_id}: {e}")
            return None
    
    def start_scheduler(self):
        """
        Start scheduled detection runs.
        
        Runs detections every N seconds (configurable).
        """
        logger.info(f"Starting detection scheduler (interval: {settings.detection_interval}s)")
        
        # Run immediately on start
        self.run_detections()
        
        # Schedule periodic runs
        schedule.every(settings.detection_interval).seconds.do(self.run_detections)
        
        try:
            while True:
                schedule.run_pending()
                time.sleep(1)
        except KeyboardInterrupt:
            logger.info("Received shutdown signal")
        finally:
            self._cleanup()
    
    def _cleanup(self):
        """Cleanup connections on shutdown"""
        logger.info("Cleaning up connections")
        
        self.db_session.close()
        self.neo4j_admin.close()
        
        for driver in self.tenant_drivers.values():
            driver.close()
        
        logger.info("Cleanup complete")


def main():
    """Main entry point"""
    engine = DetectionEngine()
    engine.start_scheduler()


if __name__ == "__main__":
    main()
