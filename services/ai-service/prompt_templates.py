from typing import Dict, List, Any


class PromptTemplates:
    """
    Prompt engineering templates for incident explanation.
    
    Templates are designed to:
    - Minimize hallucination by grounding in provided data
    - Generate actionable insights
    - Map to MITRE ATT&CK framework
    - Provide remediation steps
    """
    
    @staticmethod
    def incident_summary(
        incident_data: Dict[str, Any],
        attack_path: Dict[str, Any],
        events: List[Dict[str, Any]]
    ) -> str:
        """
        Generate prompt for incident summary.
        
        Args:
            incident_data: Incident metadata
            attack_path: Reconstructed attack path
            events: Related security events
        
        Returns:
            Formatted prompt
        
        Time complexity: O(n) where n is number of events
        """
        # Extract key information
        severity = incident_data.get('severity', 'unknown')
        attack_pattern = incident_data.get('attack_pattern', 'Unknown Attack')
        mitre_technique = incident_data.get('mitre_technique', 'N/A')
        
        # Format attack chain
        attack_chain_text = ""
        if attack_path and attack_path.get('timeline'):
            attack_chain_text = "\n".join([
                f"{i+1}. {step['description']}"
                for i, step in enumerate(attack_path['timeline'][:10])
            ])
        
        # Format events
        events_text = ""
        if events:
            events_text = "\n".join([
                f"- {event.get('event_type', 'unknown')}: {event.get('description', 'N/A')}"
                for event in events[:20]
            ])
        
        # Affected entities
        affected = attack_path.get('affected_entities', {})
        affected_text = f"""
Users: {', '.join(affected.get('users', [])[:5]) or 'None'}
Hosts: {', '.join(affected.get('hosts', [])[:5]) or 'None'}
Processes: {', '.join(affected.get('processes', [])[:5]) or 'None'}
"""
        
        prompt = f"""Analyze this security incident and provide a clear, concise explanation.

INCIDENT DETAILS:
- Severity: {severity}
- Attack Pattern: {attack_pattern}
- MITRE ATT&CK Technique: {mitre_technique}
- Confidence Score: {attack_path.get('confidence_score', 0.0)}

AFFECTED ENTITIES:
{affected_text}

ATTACK CHAIN:
{attack_chain_text or 'Attack chain not available'}

RELATED EVENTS:
{events_text or 'No events available'}

INSTRUCTIONS:
1. Provide a 2-3 sentence executive summary of what happened
2. Explain the attack progression step-by-step
3. Assess the potential impact and risk
4. DO NOT speculate beyond the provided data
5. If information is missing, explicitly state "Data not available"

Generate a clear, factual explanation suitable for security analysts."""
        
        return prompt
    
    @staticmethod
    def remediation_recommendations(
        incident_data: Dict[str, Any],
        attack_path: Dict[str, Any]
    ) -> str:
        """
        Generate prompt for remediation recommendations.
        
        Args:
            incident_data: Incident metadata
            attack_path: Reconstructed attack path
        
        Returns:
            Formatted prompt
        
        Time complexity: O(1)
        """
        severity = incident_data.get('severity', 'unknown')
        attack_pattern = incident_data.get('attack_pattern', 'Unknown Attack')
        mitre_technique = incident_data.get('mitre_technique', 'N/A')
        
        affected = attack_path.get('affected_entities', {})
        
        prompt = f"""Generate remediation recommendations for this security incident.

INCIDENT CONTEXT:
- Severity: {severity}
- Attack Pattern: {attack_pattern}
- MITRE ATT&CK Technique: {mitre_technique}

AFFECTED SYSTEMS:
- Hosts: {', '.join(affected.get('hosts', [])[:5]) or 'None'}
- Users: {', '.join(affected.get('users', [])[:5]) or 'None'}

INSTRUCTIONS:
Provide specific, actionable recommendations in these categories:

1. IMMEDIATE CONTAINMENT (stop the attack):
   - Actions to isolate affected systems
   - Network segmentation steps
   - Account lockdown procedures

2. INVESTIGATION STEPS (understand the scope):
   - Logs to review
   - Systems to inspect
   - Forensic data to collect

3. REMEDIATION (fix vulnerabilities):
   - Patches to apply
   - Configuration changes
   - Security controls to implement

4. PREVENTION (avoid recurrence):
   - Long-term security improvements
   - Policy changes
   - Monitoring enhancements

Keep recommendations specific to the attack pattern and affected systems.
Prioritize by urgency and impact."""
        
        return prompt
    
    @staticmethod
    def executive_summary(
        incident_data: Dict[str, Any],
        attack_path: Dict[str, Any],
        technical_explanation: str
    ) -> str:
        """
        Generate prompt for executive summary (non-technical audience).
        
        Args:
            incident_data: Incident metadata
            attack_path: Reconstructed attack path
            technical_explanation: Technical explanation text
        
        Returns:
            Formatted prompt
        
        Time complexity: O(1)
        """
        severity = incident_data.get('severity', 'unknown')
        attack_pattern = incident_data.get('attack_pattern', 'Unknown Attack')
        
        prompt = f"""Convert this technical security incident into an executive summary.

INCIDENT:
- Severity: {severity}
- Attack Type: {attack_pattern}

TECHNICAL EXPLANATION:
{technical_explanation[:1000]}

INSTRUCTIONS:
Create a brief executive summary (3-4 sentences) that:
1. Explains WHAT happened in business terms (no technical jargon)
2. States the IMPACT on business operations
3. Indicates the RISK level (high/medium/low)
4. Mentions the STATUS (contained, investigating, resolved)

Target audience: C-level executives with no technical background.
Focus on business impact, not technical details."""
        
        return prompt
    
    @staticmethod
    def attack_narrative(
        attack_path: Dict[str, Any]
    ) -> str:
        """
        Generate prompt for attack narrative (storytelling format).
        
        Args:
            attack_path: Reconstructed attack path
        
        Returns:
            Formatted prompt
        
        Time complexity: O(n) where n is timeline length
        """
        timeline = attack_path.get('timeline', [])
        root_cause = attack_path.get('root_cause', [])
        
        timeline_text = "\n".join([
            f"{step['step']}. [{step.get('timestamp', 'unknown time')}] {step['description']}"
            for step in timeline[:15]
        ])
        
        root_text = "Unknown initial access"
        if root_cause:
            root_text = f"{root_cause[0].get('name', 'Unknown entity')}"
        
        prompt = f"""Create a narrative timeline of this security incident.

INITIAL ACCESS:
{root_text}

ATTACK PROGRESSION:
{timeline_text or 'Timeline not available'}

INSTRUCTIONS:
Write a clear, chronological narrative that:
1. Starts with how the attacker gained initial access
2. Describes each step of the attack progression
3. Explains the attacker's objectives at each stage
4. Highlights critical decision points
5. Uses present tense for clarity

Format as a flowing narrative, not bullet points.
Keep it factual and based only on the provided timeline."""
        
        return prompt
