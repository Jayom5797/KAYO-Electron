'use client'

import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'

interface Node {
  id: string
  type: string
  label: string
  properties?: Record<string, any>
}

interface Link {
  source: string
  target: string
  type: string
  timestamp?: string
}

interface GraphData {
  nodes: Node[]
  links: Link[]
}

interface AttackGraphVisualizationProps {
  data: GraphData
  width?: number
  height?: number
}

export function AttackGraphVisualization({
  data,
  width = 800,
  height = 600,
}: AttackGraphVisualizationProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)

  useEffect(() => {
    if (!svgRef.current || !data.nodes.length) return

    // Clear previous graph
    d3.select(svgRef.current).selectAll('*').remove()

    const svg = d3.select(svgRef.current)
    const g = svg.append('g')

    // Add zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform)
      })

    svg.call(zoom)

    // Create force simulation
    const simulation = d3.forceSimulation(data.nodes as any)
      .force('link', d3.forceLink(data.links)
        .id((d: any) => d.id)
        .distance(150))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(50))

    // Create arrow markers
    svg.append('defs').selectAll('marker')
      .data(['end'])
      .enter().append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 25)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#999')

    // Create links
    const link = g.append('g')
      .selectAll('line')
      .data(data.links)
      .enter().append('line')
      .attr('stroke', '#999')
      .attr('stroke-width', 2)
      .attr('marker-end', 'url(#arrow)')

    // Create link labels
    const linkLabel = g.append('g')
      .selectAll('text')
      .data(data.links)
      .enter().append('text')
      .attr('font-size', 10)
      .attr('fill', '#666')
      .text((d) => d.type)

    // Node color based on type
    const getNodeColor = (type: string) => {
      const colors: Record<string, string> = {
        Process: '#3b82f6',
        File: '#10b981',
        Network: '#f59e0b',
        User: '#8b5cf6',
        Container: '#06b6d4',
        Host: '#ef4444',
      }
      return colors[type] || '#6b7280'
    }

    // Create nodes
    const node = g.append('g')
      .selectAll('g')
      .data(data.nodes)
      .enter().append('g')
      .attr('cursor', 'pointer')
      .call(d3.drag<any, any>()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended) as any)

    node.append('circle')
      .attr('r', 20)
      .attr('fill', (d) => getNodeColor(d.type))
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)

    node.append('text')
      .attr('dy', 35)
      .attr('text-anchor', 'middle')
      .attr('font-size', 12)
      .attr('fill', '#333')
      .text((d) => d.label.length > 15 ? d.label.substring(0, 15) + '...' : d.label)

    // Node click handler
    node.on('click', (event, d) => {
      event.stopPropagation()
      setSelectedNode(d)
    })

    // Update positions on simulation tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y)

      linkLabel
        .attr('x', (d: any) => (d.source.x + d.target.x) / 2)
        .attr('y', (d: any) => (d.source.y + d.target.y) / 2)

      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`)
    })

    function dragstarted(event: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart()
      event.subject.fx = event.subject.x
      event.subject.fy = event.subject.y
    }

    function dragged(event: any) {
      event.subject.fx = event.x
      event.subject.fy = event.y
    }

    function dragended(event: any) {
      if (!event.active) simulation.alphaTarget(0)
      event.subject.fx = null
      event.subject.fy = null
    }

    // Cleanup
    return () => {
      simulation.stop()
    }
  }, [data, width, height])

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="border border-gray-200 rounded-lg bg-white"
      />

      {selectedNode && (
        <div className="absolute top-4 right-4 bg-white border border-gray-200 rounded-lg p-4 shadow-lg max-w-xs">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm">{selectedNode.type}</h3>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              ×
            </button>
          </div>
          <div className="space-y-1 text-xs">
            <div>
              <span className="text-gray-500">ID:</span>
              <span className="ml-2 font-mono">{selectedNode.id}</span>
            </div>
            <div>
              <span className="text-gray-500">Label:</span>
              <span className="ml-2">{selectedNode.label}</span>
            </div>
            {selectedNode.properties && Object.entries(selectedNode.properties).map(([key, value]) => (
              <div key={key}>
                <span className="text-gray-500">{key}:</span>
                <span className="ml-2">{String(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-4 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-blue-500"></div>
          <span>Process</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-500"></div>
          <span>File</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-orange-500"></div>
          <span>Network</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-purple-500"></div>
          <span>User</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-cyan-500"></div>
          <span>Container</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500"></div>
          <span>Host</span>
        </div>
      </div>
    </div>
  )
}
