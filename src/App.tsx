/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, Suspense, useMemo } from 'react';
import { 
  motion, 
  useScroll, 
  useTransform, 
  useSpring, 
  AnimatePresence,
  useInView,
  useMotionValueEvent,
  MotionValue
} from 'motion/react';
import { 
  Moon as MoonIcon, 
  Globe, 
  Zap, 
  Waves, 
  ArrowRight, 
  Share2, 
  Twitter, 
  Github,
  MoveRight,
  Clock,
  Compass,
  Volume2,
  VolumeX
} from 'lucide-react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { 
  Stars, 
  Float, 
  PerspectiveCamera, 
  MeshDistortMaterial, 
  Html,
  Text,
  Line,
  Sphere,
  MeshWobbleMaterial,
  useTexture,
  Points,
  PointMaterial
} from '@react-three/drei';
import * as THREE from 'three';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { Slider } from './components/ui/slider';
import { Card, CardContent } from './components/ui/card';
import { Label } from './components/ui/label';

// --- Shaders ---

const AtmosphereShader = {
  uniforms: {
    color: { value: new THREE.Color('#3b82f6') },
    density: { value: 1.0 },
  },
  vertexShader: `
    varying vec3 vNormal;
    varying vec3 vEyeVector;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vEyeVector = -normalize(mvPosition.xyz);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    uniform vec3 color;
    uniform float density;
    varying vec3 vNormal;
    varying vec3 vEyeVector;
    void main() {
      float intensity = pow(0.7 - dot(vNormal, vEyeVector), 3.0) * density;
      gl_FragColor = vec4(color, 1.0) * intensity;
    }
  `
};

const MoonRimShader = {
  uniforms: {
    color: { value: new THREE.Color('#ffffff') },
    intensity: { value: 0.15 },
  },
  vertexShader: `
    varying vec3 vNormal;
    varying vec3 vEyeVector;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vEyeVector = -normalize(mvPosition.xyz);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    uniform vec3 color;
    uniform float intensity;
    varying vec3 vNormal;
    varying vec3 vEyeVector;
    void main() {
      float rim = pow(1.0 - max(dot(vNormal, vEyeVector), 0.0), 4.0) * intensity;
      gl_FragColor = vec4(color, rim);
    }
  `
};

const MagmaShader = {
  uniforms: {
    time: { value: 0 },
    intensity: { value: 0 },
    uOpacity: { value: 1.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vNormal;
    void main() {
      vUv = uv;
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float time;
    uniform float intensity;
    uniform float uOpacity;
    varying vec2 vUv;
    varying vec3 vNormal;

    vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
    float snoise(vec2 v){
      const vec4 C = vec4(0.211324865405187, 0.366025403784439,
               -0.577350269189626, 0.024390243902439);
      vec2 i  = floor(v + dot(v, C.yy) );
      vec2 x0 = v -   i + dot(i, C.xx);
      vec2 i1;
      i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod(i, 289.0);
      vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
      + i.x + vec3(0.0, i1.x, 1.0 ));
      vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
        dot(x12.zw,x12.zw)), 0.0);
      m = m*m ;
      m = m*m ;
      vec3 x = 2.0 * fract(p * C.www) - 1.0;
      vec3 h = abs(x) - 0.5;
      vec3 a0 = x - floor(x + 0.5);
      vec3 g = a0 * vec3(x0.x,x12.xz) + h * vec3(x0.y,x12.yw);
      vec3 l = 1.79284291400159 - 0.85373472095314 * ( g*g + h*h );
      vec3 r = g * l.x + h * l.y;
      return 130.0 * dot(m, r);
    }

    void main() {
      float n = snoise(vUv * 8.0 + time * 0.3);
      float n2 = snoise(vUv * 15.0 - time * 0.1);
      float combined = (n + n2) * 0.5;
      
      vec3 color1 = vec3(1.0, 0.4, 0.0); // Bright orange
      vec3 color2 = vec3(0.8, 0.1, 0.0); // Red
      vec3 color3 = vec3(0.1, 0.02, 0.0); // Dark crust
      
      vec3 magma = mix(color2, color1, smoothstep(0.0, 0.8, combined));
      magma = mix(color3, magma, smoothstep(-0.4, 0.3, combined));
      
      gl_FragColor = vec4(magma * intensity, uOpacity);
    }
  `
};

// --- 3D Scene Components ---

const TwinklingStars = () => {
  const starsRef = useRef<THREE.Points>(null);
  const count = 6000;
  
  const [positions, sizes, opacities] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const s = new Float32Array(count);
    const o = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = 100 + Math.random() * 100;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
      
      s[i] = Math.random() * 0.5 + 0.1;
      o[i] = Math.random();
    }
    return [pos, s, o];
  }, []);

  useFrame((state) => {
    if (starsRef.current) {
      const time = state.clock.getElapsedTime();
      // Subtle rotation
      starsRef.current.rotation.y = time * 0.01;
      starsRef.current.rotation.x = time * 0.005;
    }
  });

  return (
    <Points ref={starsRef} positions={positions} stride={3}>
      <PointMaterial
        transparent
        size={0.2}
        sizeAttenuation={true}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        color="#ffffff"
      />
    </Points>
  );
};

const ImpactEffect = ({ scrollYProgress }: { scrollYProgress: MotionValue<number> }) => {
  const plasmaRef = useRef<THREE.Mesh>(null);
  const shockwaveRef = useRef<THREE.Mesh>(null);
  const plasmaMatRef = useRef<THREE.ShaderMaterial>(null);
  
  const scale = useTransform(scrollYProgress, [0.39, 0.4, 0.45, 0.6], [0, 5, 15, 0]);
  const intensity = useTransform(scrollYProgress, [0.39, 0.4, 0.5, 0.7], [0, 20, 10, 0]);
  const shockScale = useTransform(scrollYProgress, [0.395, 0.45, 0.7], [0, 25, 50]);
  const shockOpacity = useTransform(scrollYProgress, [0.395, 0.42, 0.7], [0, 0.8, 0]);

  useFrame((state) => {
    if (plasmaMatRef.current) {
      plasmaMatRef.current.uniforms.time.value = state.clock.getElapsedTime();
      plasmaMatRef.current.uniforms.intensity.value = intensity.get();
    }
    if (plasmaRef.current) {
      plasmaRef.current.scale.setScalar(scale.get());
      plasmaRef.current.rotation.y += 0.02;
      plasmaRef.current.rotation.z += 0.01;
    }
    if (shockwaveRef.current) {
      shockwaveRef.current.scale.setScalar(shockScale.get());
      const mat = shockwaveRef.current.material as THREE.MeshStandardMaterial;
      mat.opacity = shockOpacity.get();
    }
  });

  return (
    <group>
      {/* Plasma Core */}
      <mesh ref={plasmaRef}>
        <sphereGeometry args={[1, 64, 64]} />
        <shaderMaterial 
          ref={plasmaMatRef}
          uniforms={useMemo(() => ({
            time: { value: 0 },
            intensity: { value: 0 },
          }), [])}
          vertexShader={`
            varying vec2 vUv;
            varying vec3 vPosition;
            varying vec3 vNormal;
            void main() {
              vUv = uv;
              vPosition = position;
              vNormal = normalize(normalMatrix * normal);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={`
            uniform float time;
            uniform float intensity;
            varying vec3 vPosition;
            varying vec3 vNormal;

            // Simplex 3D Noise
            vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
            vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
            float snoise(vec3 v){ 
              const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
              const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
              vec3 i  = floor(v + dot(v, C.yyy) );
              vec3 x0 =   v - i + dot(i, C.xxx) ;
              vec3 g = step(x0.yzx, x0.xyz);
              vec3 l = 1.0 - g;
              vec3 i1 = min( g.xyz, l.zxy );
              vec3 i2 = max( g.xyz, l.zxy );
              vec3 x1 = x0 - i1 + 1.0 * C.xxx;
              vec3 x2 = x0 - i2 + 2.0 * C.xxx;
              vec3 x3 = x0 - 1. + 3.0 * C.xxx;
              i = mod(i, 289.0 ); 
              vec4 p = permute( permute( permute( 
                         i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                       + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
                       + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
              float n_ = 1.0/7.0;
              vec3  ns = n_ * D.wyz - D.xzx;
              vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
              vec4 x_ = floor(j * ns.z);
              vec4 y_ = floor(j - 7.0 * x_ );
              vec4 x = x_ *ns.x + ns.yyyy;
              vec4 y = y_ *ns.x + ns.yyyy;
              vec4 h = 1.0 - abs(x) - abs(y);
              vec4 b0 = vec4( x.xy, y.xy );
              vec4 b1 = vec4( x.zw, y.zw );
              vec4 s0 = floor(b0)*2.0 + 1.0;
              vec4 s1 = floor(b1)*2.0 + 1.0;
              vec4 sh = -step(h, vec4(0.0));
              vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
              vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
              vec3 p0 = vec3(a0.xy,h.x);
              vec3 p1 = vec3(a0.zw,h.y);
              vec3 p2 = vec3(a1.xy,h.z);
              vec3 p3 = vec3(a1.zw,h.w);
              vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
              p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
              vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
              m = m * m;
              return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
            }

            void main() {
              float n = snoise(vPosition * 2.0 + time * 1.5);
              float n2 = snoise(vPosition * 4.0 - time * 0.8);
              float combined = (n + n2 * 0.5) * 0.7;
              
              vec3 coreColor = vec3(1.0, 1.0, 0.9); // White-hot
              vec3 midColor = vec3(1.0, 0.5, 0.0);  // Vivid Orange
              vec3 edgeColor = vec3(0.8, 0.1, 0.0); // Magma Red
              
              vec3 color = mix(edgeColor, midColor, combined + 0.5);
              color = mix(color, coreColor, pow(max(0.0, combined + 0.3), 3.0));
              
              float fresnel = pow(1.0 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
              float alpha = (combined + 0.6) * intensity * 0.15 + fresnel * intensity * 0.1;
              
              gl_FragColor = vec4(color, alpha);
            }
          `}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      
      {/* Shockwave Ring */}
      <mesh ref={shockwaveRef} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1, 0.05, 16, 100]} />
        <meshStandardMaterial 
          color="#ffaa00"
          emissive="#ff4400"
          emissiveIntensity={15}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
};

const Debris = ({ scrollYProgress }: { scrollYProgress: MotionValue<number> }) => {
  const groupRef = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const count = 10000; // Even more for catastrophic feel
  
  const particles = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;
      
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      // More explosive velocities
      const speed = Math.random() * 25 + 10;
      
      velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      velocities[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * speed;
      velocities[i * 3 + 2] = Math.cos(phi) * speed;

      const mix = Math.random();
      if (mix > 0.7) {
        colors[i * 3] = 1.0; colors[i * 3 + 1] = 1.0; colors[i * 3 + 2] = 0.95; // White-hot
      } else if (mix > 0.3) {
        colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.5; colors[i * 3 + 2] = 0.05; // Vivid Orange
      } else {
        colors[i * 3] = 0.8; colors[i * 3 + 1] = 0.1; colors[i * 3 + 2] = 0.02; // Deep Magma
      }
      
      randoms[i] = Math.random();
      sizes[i] = Math.random() * 0.8 + 0.2;
    }
    return { positions, velocities, colors, randoms, sizes };
  }, []);

  const collisionProgress = useTransform(scrollYProgress, [0.39, 0.65], [0, 1]);

  useFrame((state) => {
    if (groupRef.current) {
      // Subtle rotation of the entire debris cloud
      groupRef.current.rotation.y += 0.001;
      groupRef.current.rotation.z += 0.0005;
    }
    
    if (pointsRef.current) {
      const progress = collisionProgress.get();
      const positions = pointsRef.current.geometry.attributes.position.array as Float32Array;
      
      if (progress > 0) {
        for (let i = 0; i < count; i++) {
          // Add gravitational pull simulation - particles slow down and spread
          const drag = 1.0 - (progress * 0.5);
          const timeDrift = state.clock.elapsedTime * 0.2;
          const turbulence = Math.sin(state.clock.elapsedTime * 12 + i) * 0.5 * progress;
          const scatter = (1 + progress * particles.randoms[i] * 12 + timeDrift * particles.randoms[i]) + turbulence;
          
          positions[i * 3] = particles.velocities[i * 3] * progress * 35 * scatter * drag;
          positions[i * 3 + 1] = particles.velocities[i * 3 + 1] * progress * 35 * scatter * drag;
          positions[i * 3 + 2] = particles.velocities[i * 3 + 2] * progress * 35 * scatter * drag;
        }
        pointsRef.current.geometry.attributes.position.needsUpdate = true;
      } else {
        for (let i = 0; i < count; i++) {
          positions[i * 3] = 0;
          positions[i * 3 + 1] = 0;
          positions[i * 3 + 2] = 0;
        }
        pointsRef.current.geometry.attributes.position.needsUpdate = true;
      }
    }
  });

  return (
    <group ref={groupRef}>
      <ImpactEffect scrollYProgress={scrollYProgress} />
      <Points ref={pointsRef} positions={particles.positions} colors={particles.colors} stride={3}>
        <PointMaterial
          transparent
          vertexColors
          size={0.3}
          sizeAttenuation={true}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </Points>
    </group>
  );
};

const Earth = ({ scrollYProgress, mouse, atmosphereDensity }: { scrollYProgress: MotionValue<number>, mouse: React.MutableRefObject<[number, number]>, atmosphereDensity: number }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const cloudsRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const spinGroupRef = useRef<THREE.Group>(null);
  const magmaRef = useRef<THREE.ShaderMaterial>(null);
  const atmosphereRef = useRef<THREE.ShaderMaterial>(null);
  
  // Using reliable resolution textures for Earth
  const [earthMap, cloudsMap, normalMap, specularMap] = useTexture([
    'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_atmos_2048.jpg',
    'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_clouds_1024.png',
    'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_normal_2048.jpg',
    'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_specular_2048.jpg'
  ]);

  const rawRotationSpeed = useTransform(scrollYProgress, [0, 0.4, 0.6, 1], [0.05, 0.3, 0.1, 0.1]);
  const rotationSpeed = useSpring(rawRotationSpeed, { stiffness: 50, damping: 20 });
  
  const tilt = useTransform(scrollYProgress, [0.4, 0.6], [0, 23.5 * (Math.PI / 180)]);
  const xPos = useTransform(scrollYProgress, [0, 0.3, 0.4], [0, 2, 0]);
  const yPos = useTransform(scrollYProgress, [0, 0.3, 0.4], [-3.5, 0.8, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.3, 0.4, 0.6, 0.9, 1], [5, 1.2, 1.2, 3.5, 6, 8]);
  const magmaIntensity = useTransform(scrollYProgress, [0.35, 0.45, 0.5, 0.8], [0, 15, 45, 0]);
  const earthOpacity = useTransform(scrollYProgress, [0, 0.4, 0.6], [1, 0.6, 1]);
  const earthColor = useTransform(scrollYProgress, [0.35, 0.45], ["#442211", "#ffffff"]);
  const dynamicAtmosphere = useTransform(scrollYProgress, [0.4, 0.5], [0, atmosphereDensity]);

  useFrame((state, delta) => {
    const currentTilt = tilt.get();
    const currentRotationSpeed = rotationSpeed.get();
    const currentScale = scale.get();
    const currentMagmaIntensity = magmaIntensity.get();
    const currentEarthOpacity = earthOpacity.get();
    const currentEarthColor = earthColor.get();

    if (spinGroupRef.current) {
      // Smooth continuous rotation
      spinGroupRef.current.rotation.y += delta * currentRotationSpeed;
    }

    if (groupRef.current) {
      groupRef.current.position.x = xPos.get();
      groupRef.current.position.y = yPos.get();
      groupRef.current.scale.setScalar(currentScale);
      groupRef.current.rotation.z = currentTilt;
    }

    if (meshRef.current) {
      // Mouse interaction as a subtle tilt/offset
      meshRef.current.rotation.x += (mouse.current[1] * 0.15 - meshRef.current.rotation.x) * 0.05;
      meshRef.current.rotation.y += (mouse.current[0] * 0.15 - meshRef.current.rotation.y) * 0.05;
      
      const mat = meshRef.current.material as THREE.MeshPhongMaterial;
      mat.opacity = currentEarthOpacity;
      mat.color.set(currentEarthColor);
    }

    if (cloudsRef.current) {
      // Clouds rotate slightly independently for parallax effect
      cloudsRef.current.rotation.y += delta * (currentRotationSpeed + 0.02);
      (cloudsRef.current.material as THREE.MeshPhongMaterial).opacity = 0.4 * dynamicAtmosphere.get();
    }

    if (magmaRef.current) {
      magmaRef.current.uniforms.time.value = state.clock.getElapsedTime();
      magmaRef.current.uniforms.intensity.value = currentMagmaIntensity;
      magmaRef.current.uniforms.uOpacity.value = 1.0;
    }
    if (atmosphereRef.current) {
      atmosphereRef.current.uniforms.density.value = dynamicAtmosphere.get();
    }
  });

  const atmosphereShader = useMemo(() => ({
    uniforms: {
      color: { value: new THREE.Color('#3b82f6') },
      density: { value: atmosphereDensity },
    },
    vertexShader: AtmosphereShader.vertexShader,
    fragmentShader: AtmosphereShader.fragmentShader
  }), [atmosphereDensity]);

  return (
    <group ref={groupRef}>
      <group ref={spinGroupRef}>
        <mesh ref={meshRef} receiveShadow castShadow>
          <sphereGeometry args={[1.5, 64, 64]} />
          <meshPhongMaterial 
            map={earthMap}
            normalMap={normalMap}
            specularMap={specularMap}
            specular={new THREE.Color('grey')}
            shininess={5}
            transparent
          />
        </mesh>
        <mesh scale={[1.01, 1.01, 1.01]}>
          <sphereGeometry args={[1.5, 64, 64]} />
          <shaderMaterial
            ref={magmaRef}
            uniforms={useMemo(() => ({
              time: { value: 0 },
              intensity: { value: 0 },
              uOpacity: { value: 1.0 },
            }), [])}
            vertexShader={MagmaShader.vertexShader}
            fragmentShader={MagmaShader.fragmentShader}
            transparent
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <mesh ref={cloudsRef}>
          <sphereGeometry args={[1.52, 64, 64]} />
          <meshPhongMaterial 
            map={cloudsMap} 
            transparent 
            opacity={0.4 * atmosphereDensity} 
            depthWrite={false}
          />
        </mesh>
      </group>
      <mesh scale={[1.01, 1.01, 1.01]}>
        <sphereGeometry args={[1.5, 64, 64]} />
        <shaderMaterial
          ref={atmosphereRef}
          {...atmosphereShader}
          side={THREE.BackSide}
          transparent
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
};

const Moon = ({ scrollYProgress }: { scrollYProgress: MotionValue<number> }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const rimRef = useRef<THREE.ShaderMaterial>(null);
  const groupRef = useRef<THREE.Group>(null);
  
  const moonTextures = useTexture({
    map: 'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/moon_1024.jpg',
    displacementMap: 'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/moon_1024.jpg',
    bumpMap: 'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/moon_1024.jpg',
  });

  // Moon appears right after the explosion (0.3) and rebirth (0.35-0.45)
  const orbitRadius = useTransform(scrollYProgress, [0.4, 0.6, 0.8, 1], [6, 8, 12, 18]);
  const orbitAngle = useTransform(scrollYProgress, [0.4, 1], [0, Math.PI * 4]);
  const farewellDistance = useTransform(scrollYProgress, [0.8, 1], [0, 8]);
  const moonOpacity = useTransform(scrollYProgress, [0.4, 0.45], [0, 1]);
  const moonScale = useTransform(scrollYProgress, [0.4, 0.6, 0.8, 0.9, 1], [0.2, 0.8, 2.5, 6, 8]);

  useFrame((state) => {
    if (groupRef.current) {
      const angle = orbitAngle.get();
      const radius = orbitRadius.get() + farewellDistance.get();
      groupRef.current.position.x = Math.cos(angle) * radius;
      groupRef.current.position.z = Math.sin(angle) * radius;
      groupRef.current.rotation.y += 0.005;
      groupRef.current.scale.setScalar(moonScale.get());
    }
    if (meshRef.current) {
      (meshRef.current.material as any).opacity = moonOpacity.get();
    }
    if (rimRef.current) {
      rimRef.current.uniforms.intensity.value = 0.15 * moonOpacity.get();
    }
  });

  return (
    <group ref={groupRef}>
      {/* Main Moon Body */}
      <mesh ref={meshRef} castShadow receiveShadow>
        <sphereGeometry args={[0.4, 256, 256]} />
        <meshStandardMaterial 
          {...moonTextures}
          displacementScale={0.02}
          bumpScale={0.015}
          roughness={0.9} 
          metalness={0.05}
          emissive="#ffffff"
          emissiveIntensity={0.002}
          transparent
        />
      </mesh>
      {/* Rim Glow for realism at edges */}
      <mesh scale={[1.02, 1.02, 1.02]}>
        <sphereGeometry args={[0.4, 64, 64]} />
        <shaderMaterial
          ref={rimRef}
          {...MoonRimShader}
          transparent
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
};

const Theia = ({ scrollYProgress }: { scrollYProgress: MotionValue<number> }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  
  const xPos = useTransform(scrollYProgress, [0.2, 0.4], [-30, 0]);
  const opacity = useTransform(scrollYProgress, [0.38, 0.4, 0.45], [0, 1, 0]);
  const scale = useTransform(scrollYProgress, [0.38, 0.4], [0, 1.8]);
  // Theia heats up intensely as it approaches
  const magmaIntensity = useTransform(scrollYProgress, [0.38, 0.39, 0.4, 0.45], [0, 15, 40, 0]);
  const colorShift = useTransform(scrollYProgress, [0.38, 0.4], ["#ff6600", "#ffffff"]);

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.position.x = xPos.get();
      groupRef.current.scale.setScalar(scale.get());
      groupRef.current.rotation.y += 0.01;
      groupRef.current.rotation.x += 0.005;
    }
    if (materialRef.current) {
      materialRef.current.uniforms.time.value = state.clock.getElapsedTime();
      materialRef.current.uniforms.intensity.value = magmaIntensity.get();
      materialRef.current.uniforms.uOpacity.value = opacity.get();
    }
  });

  return (
    <group ref={groupRef}>
      <mesh ref={meshRef}>
        <sphereGeometry args={[1, 64, 64]} />
        <shaderMaterial
          ref={materialRef}
          uniforms={useMemo(() => ({
            time: { value: 0 },
            intensity: { value: 0 },
            uOpacity: { value: 0 },
          }), [])}
          vertexShader={MagmaShader.vertexShader}
          fragmentShader={MagmaShader.fragmentShader}
          transparent
        />
      </mesh>
    </group>
  );
};

const Scene = ({ scrollYProgress, mouse, atmosphereDensity }: { scrollYProgress: MotionValue<number>, mouse: React.MutableRefObject<[number, number]>, atmosphereDensity: number }) => {
  const { camera } = useThree();
  const [bloomIntensityVal, setBloomIntensityVal] = useState(1);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  
  // Cinematic camera paths
  // Stage 1: Intro (z: 10)
  // Stage 2: Theia Approach (z: 4, grazing)
  // Stage 3: Impact (z: 3, shake)
  // Stage 4: Moon Formation (z: 15, wide)
  // Stage 5: System Tracking (z: 25, orbit)
  const camZ = useTransform(scrollYProgress, [0, 0.3, 0.4, 0.6, 0.8, 0.9, 1], [8, 4.5, 3.5, 15, 22, 30, 35]);
  const camX = useTransform(scrollYProgress, [0, 0.3, 0.4, 0.6, 0.8, 0.9, 1], [0, 2.2, 3, -10, 5, 2, 6]);
  const camY = useTransform(scrollYProgress, [0, 0.3, 0.4, 0.6, 0.8, 0.9, 1], [0, 0.8, 1.5, 4, -2, 0, 1]);
  
  // Grazing angle target offset - shifts focus to the limb of the Earth
  const targetX = useTransform(scrollYProgress, [0, 0.25, 0.35, 0.45, 0.6, 1], [0, 1.4, 1.8, 0, 0, 0]);
  const targetY = useTransform(scrollYProgress, [0, 0.25, 0.35, 0.45, 0.6, 1], [0, 0.3, 0.5, 0, 0, 0]);
  
  // Moon tracking parameters (matching Moon component)
  const moonOrbitRadius = useTransform(scrollYProgress, [0.4, 0.6, 0.8, 1], [6, 8, 12, 18]);
  const moonOrbitAngle = useTransform(scrollYProgress, [0.4, 1], [0, Math.PI * 4]);
  const moonFarewell = useTransform(scrollYProgress, [0.8, 1], [0, 8]);

  const shake = useTransform(scrollYProgress, [0.39, 0.4, 0.45], [0, 4.5, 0]);
  const bloomIntensity = useTransform(scrollYProgress, [0.39, 0.4, 0.45], [1, 25, 1]);

  useMotionValueEvent(bloomIntensity, "change", (latest) => {
    setBloomIntensityVal(latest);
  });

  useFrame((state) => {
    const time = state.clock.getElapsedTime();
    const s = shake.get();
    const shakeX = (Math.random() - 0.5) * s;
    const shakeY = (Math.random() - 0.5) * s;
    
    // Slow cinematic orbital drift (more complex 3D path)
    const driftX = Math.sin(time * 0.15) * 0.8;
    const driftY = Math.cos(time * 0.1) * 0.5;
    const driftZ = Math.sin(time * 0.05) * 0.4;
    
    const currentCamX = camX.get() + shakeX + driftX;
    const currentCamY = camY.get() + shakeY + driftY;
    const currentCamZ = camZ.get() + driftZ;
    
    camera.position.set(currentCamX, currentCamY, currentCamZ);
    
    // Dynamic lookAt: Focus shifts from Earth limb to the Earth-Moon center of mass
    const progress = scrollYProgress.get();
    let lookTarget = new THREE.Vector3(targetX.get(), targetY.get(), 0);
    
    if (progress > 0.6) {
      // Transition focus towards the Moon as it orbits
      const angle = moonOrbitAngle.get();
      const radius = moonOrbitRadius.get() + moonFarewell.get();
      const moonPos = new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      
      // Blend target between Earth (0,0,0) and Moon based on progress
      // In the final chapter (progress > 0.85), return focus to Earth center
      const moonWeight = progress > 0.85 ? 0 : (progress - 0.6) * 1.5; 
      lookTarget.lerp(moonPos, Math.min(moonWeight, 0.4)); // Keep focus mostly on system center
    }
    
    camera.lookAt(lookTarget);

    if (sunRef.current) {
      // Subtle sun twinkle: base intensity (2) + multi-layered modulation for natural feel
      const twinkle = 
        Math.sin(time * 4.0) * 0.05 + 
        Math.sin(time * 1.5) * 0.03 + 
        Math.sin(time * 10.0) * 0.01;
      sunRef.current.intensity = 2 + twinkle;
    }
  });

  return (
    <>
      <ambientLight intensity={0.1} />
      <directionalLight 
        ref={sunRef}
        position={[20, 10, 10]} 
        intensity={2} 
        castShadow 
        shadow-mapSize={[2048, 2048]}
      />
      <TwinklingStars />
      
      <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
        <Earth scrollYProgress={scrollYProgress} mouse={mouse} atmosphereDensity={atmosphereDensity} />
      </Float>
 
      <Moon scrollYProgress={scrollYProgress} />
      <Theia scrollYProgress={scrollYProgress} />
      <Debris scrollYProgress={scrollYProgress} />

      <EffectComposer enableNormalPass={false} multisampling={0}>
        <Bloom 
          luminanceThreshold={0.2} 
          luminanceSmoothing={0.9} 
          intensity={bloomIntensityVal} 
        />
      </EffectComposer>
    </>
  );
};

// --- UI Components ---

const BackgroundMusic = ({ isPlaying, toggleMusic }: { isPlaying: boolean, toggleMusic: () => void }) => {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = 0.4;
      if (isPlaying) {
        audioRef.current.play().catch(err => console.log("Autoplay blocked:", err));
      } else {
        audioRef.current.pause();
      }
    }
  }, [isPlaying]);

  return (
    <>
      <audio 
        ref={audioRef}
        src="https://assets.mixkit.co/music/preview/mixkit-ethereal-space-ambient-592.mp3" 
        loop 
      />
      <motion.button
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 2 }}
        onClick={toggleMusic}
        className="fixed top-8 right-8 z-[100] p-4 rounded-full bg-black/20 backdrop-blur-md border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition-all shadow-xl"
        title={isPlaying ? "Mute Music" : "Play Music"}
      >
        {isPlaying ? <Volume2 size={20} /> : <VolumeX size={20} />}
      </motion.button>
    </>
  );
};

const SystemOrigin = ({ scrollYProgress }: { scrollYProgress: MotionValue<number> }) => {
  const text = "ORIGIN: USEF ALY // SECTOR: CREATIVE ENGINE";
  const [displayText, setDisplayText] = useState("");
  const [index, setIndex] = useState(0);
  const [isTyping, setIsTyping] = useState(false);

  useMotionValueEvent(scrollYProgress, "change", (latest) => {
    // Once triggered, it stays triggered as long as we are in the final chapter
    if (latest >= 0.85) {
      if (!isTyping) setIsTyping(true);
    } else if (latest < 0.8) { // Only reset if we scroll back up significantly
      if (isTyping) {
        setIsTyping(false);
        setDisplayText("");
        setIndex(0);
      }
    }
  });

  useEffect(() => {
    if (isTyping && index < text.length) {
      const timeout = setTimeout(() => {
        setDisplayText(prev => prev + text[index]);
        setIndex(prev => prev + 1);
      }, 40 + Math.random() * 30);
      return () => clearTimeout(timeout);
    }
  }, [index, isTyping]);

  // Position it at the bottom center in the final scene
  // Starts appearing as we enter the final chapter (around 0.85) and stays visible
  const opacity = useTransform(scrollYProgress, [0.85, 0.92, 1], [0, 1, 1]);
  const bottom = "80px";
  const scale = 1;
  const blur = useTransform(scrollYProgress, [0.85, 0.92, 1], [10, 0, 0]);

  return (
    <motion.div 
      style={{ 
        left: "50%", 
        x: "-50%", 
        bottom, 
        opacity, 
        scale,
        filter: useTransform(blur, (v) => `blur(${v}px)`)
      }}
      className="fixed z-[100] font-mono text-[10px] md:text-[12px] tracking-[0.4em] text-white flex items-center gap-6 whitespace-nowrap bg-black/60 backdrop-blur-2xl px-12 py-6 rounded-full border border-white/5 shadow-[0_0_80px_rgba(0,0,0,0.8)]"
    >
      <div className="w-2 h-2 bg-earth-blue rounded-full shadow-[0_0_15px_#3b82f6] animate-pulse" />
      <div className="flex items-center">
        <span className="text-white/80 uppercase">{displayText}</span>
        {isTyping && index < text.length && (
          <motion.span 
            animate={{ opacity: [1, 0] }}
            transition={{ duration: 0.5, repeat: Infinity, times: [0, 1] }}
            className="ml-2 w-1.5 h-4 bg-earth-blue/60 inline-block"
          />
        )}
      </div>
    </motion.div>
  );
};

const Hero = ({ onStart, scrollYProgress, toggleMusic, isMusicPlaying }: { onStart: () => void, scrollYProgress: MotionValue<number>, toggleMusic: () => void, isMusicPlaying: boolean }) => {
  const opacity = useTransform(scrollYProgress, [0, 0.15], [1, 0]);
  const y = useTransform(scrollYProgress, [0, 0.15], [0, -100]);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.3,
        delayChildren: 0.5
      }
    }
  } as const;

  const itemVariants = {
    hidden: { opacity: 0, y: 30, filter: "blur(10px)" },
    visible: { 
      opacity: 1, 
      y: 0, 
      filter: "blur(0px)",
      transition: { duration: 1, ease: "easeOut" }
    }
  } as const;

  return (
    <section className="relative h-screen flex flex-col items-center justify-between py-24 px-6 text-center overflow-hidden ui-overlay">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        style={{ opacity, y }}
        className="flex flex-col items-center"
      >
        <motion.span 
          variants={itemVariants}
          className="text-white/40 font-mono tracking-[0.4em] uppercase text-xs mb-8"
        >
          A Celestial Odyssey
        </motion.span>
        <motion.h1 
          variants={itemVariants}
          className="text-5xl md:text-8xl font-light tracking-[0.6em] text-white mb-12 uppercase"
        >
          Guardian
        </motion.h1>
        <motion.div variants={itemVariants} className="w-24 h-px bg-white/20 mb-12" />
        <motion.p 
          variants={itemVariants}
          className="text-sm md:text-base text-white/40 tracking-[0.3em] uppercase max-w-2xl mx-auto leading-loose"
        >
          Born of Fire
        </motion.p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.5, duration: 1 }}
        style={{ opacity }}
        className="flex flex-col items-center gap-8"
      >
        <div className="text-2xl md:text-4xl font-light tracking-[0.5em] text-white/80">
          4.5.000.000.000
        </div>
        
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => { 
            onStart(); 
            if (!isMusicPlaying) toggleMusic();
          }}
          className="group relative px-12 py-4 border border-white/20 text-white font-light tracking-[0.3em] uppercase text-xs rounded-full transition-all hover:bg-white hover:text-black overflow-hidden"
        >
          <span className="relative z-10">Begin Journey</span>
          <motion.div 
            className="absolute inset-0 bg-white translate-y-full group-hover:translate-y-0 transition-transform duration-300"
          />
        </motion.button>
      </motion.div>

      <motion.div 
        style={{ opacity }}
        animate={{ y: [0, 10, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", times: [0, 0.5, 1] }}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/20"
      >
        <div className="w-px h-12 bg-gradient-to-b from-white/50 to-transparent mx-auto" />
      </motion.div>
    </section>
  );
};

const CollisionSection = () => {
  const { scrollYProgress } = useScroll();
  // Text fades out completely by 0.35, well before the explosion peaks at 0.45-0.5
  const textOpacity = useTransform(scrollYProgress, [0.2, 0.25, 0.35], [0, 1, 0]);
  const cardY = useTransform(scrollYProgress, [0.2, 0.4], [100, -100]);
  const textY = useTransform(scrollYProgress, [0.2, 0.4], [50, -150]); // Parallax: text moves faster

  return (
    <section className="relative h-[300vh] ui-overlay">
      <div className="sticky top-0 h-screen flex items-center justify-start px-6 md:px-20 overflow-hidden">
        <motion.div 
          style={{ opacity: textOpacity, y: cardY }}
          className="max-w-md glass-card p-10 backdrop-blur-md bg-black/20 floating-text"
        >
          <motion.div style={{ y: textY }}>
            <h2 className="text-4xl font-bold mb-4">Chapter I: <span className="text-orange-500">The Impact</span></h2>
            <p className="text-white/60 leading-relaxed">
              4.5 billion years ago, a Mars-sized planet named Theia struck the Proto-Earth. The collision was so violent it vaporized both worlds, sending a ring of debris into orbit that eventually coalesced to form our Moon.
            </p>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
};

const StabilizerSection = () => {
  const [rotation, setRotation] = useState(6);
  const sectionRef = useRef(null);
  const isInView = useInView(sectionRef, { once: false, amount: 0.5 });

  useEffect(() => {
    if (isInView) {
      const interval = setInterval(() => {
        setRotation(prev => (prev < 24 ? prev + 0.5 : 24));
      }, 50);
      return () => clearInterval(interval);
    } else {
      setRotation(6);
    }
  }, [isInView]);

  return (
    <section ref={sectionRef} className="py-32 px-6 max-w-7xl mx-auto ui-overlay">
      <div className="grid md:grid-cols-2 gap-16 items-center">
        <motion.div 
          initial={{ opacity: 0, x: -50 }}
          whileInView={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="glass-card p-10 backdrop-blur-md bg-black/20"
        >
          <h2 className="text-4xl md:text-5xl font-bold mb-8">Chapter II: The Stabilizer</h2>
          <div className="space-y-6">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="p-6 bg-white/5 rounded-xl border border-white/10"
            >
              <div className="flex items-center gap-4 mb-4">
                <div className="p-3 bg-earth-blue/20 rounded-xl">
                  <Compass className="text-earth-blue w-6 h-6" />
                </div>
                <h3 className="text-xl font-semibold">Taming the Tilt</h3>
              </div>
              <p className="text-white/60">
                Without the Moon's <span className="text-yellow-500 font-bold">gravitational</span> pull, Earth's tilt would wobble violently, causing extreme climatic shifts.
              </p>
            </motion.div>
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="p-6 bg-white/5 rounded-xl border border-white/10"
            >
              <div className="flex items-center gap-4 mb-4">
                <div className="p-3 bg-earth-blue/20 rounded-xl">
                  <Clock className="text-earth-blue w-6 h-6" />
                </div>
                <h3 className="text-xl font-semibold">Slowing the Spin</h3>
              </div>
              <p className="text-white/60">
                The Moon's gravity acts as a brake. Today, we have a stable 24-hour day.
              </p>
            </motion.div>
          </div>
        </motion.div>
        <motion.div 
          initial={{ opacity: 0, scale: 0.8 }}
          whileInView={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, ease: "backOut" }}
          className="flex flex-col items-center justify-center"
        >
          <div className="relative w-64 h-64 md:w-80 md:h-80 glass-card p-10 flex flex-col items-center justify-center">
            <span className="text-7xl font-bold text-earth-blue">{Math.floor(rotation)}h</span>
            <span className="text-white/40 text-sm uppercase tracking-widest mt-2">Day Length</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

const TidalSection = () => {
  const { scrollYProgress } = useScroll();
  const opacity = useTransform(scrollYProgress, [0.7, 0.8, 0.9], [0, 1, 0]);
  const y = useTransform(scrollYProgress, [0.7, 0.9], [50, -50]);
  const blur = useTransform(scrollYProgress, [0.7, 0.8, 0.9], [10, 0, 10]);

  return (
    <section className="h-[150vh] px-6 ui-overlay flex items-center justify-center">
      <motion.div 
        style={{ opacity, y, filter: useTransform(blur, (v) => `blur(${v}px)`) }}
        className="glass-card p-12 backdrop-blur-md bg-black/20 text-center max-w-3xl"
      >
        <h2 className="text-4xl md:text-5xl font-bold mb-6">Chapter III: The Tidal Dance</h2>
        <p className="text-white/60 max-w-2xl mx-auto text-lg">
          The Moon reaches out with an invisible gravitational arm, pulling Earth's oceans toward it and creating the rhythmic pulse of the tides.
        </p>
      </motion.div>
    </section>
  );
};

const FarewellSection = () => {
  const [distance, setDistance] = useState(0);
  const sectionRef = useRef(null);
  const isInView = useInView(sectionRef, { once: false, amount: 0.5 });

  useEffect(() => {
    if (isInView) {
      const interval = setInterval(() => {
        setDistance(prev => (prev < 3.8 ? +(prev + 0.1).toFixed(1) : 3.8));
      }, 50);
      return () => clearInterval(interval);
    } else {
      setDistance(0);
    }
  }, [isInView]);

  return (
    <section ref={sectionRef} className="py-32 px-6 flex flex-col items-center justify-center text-center ui-overlay">
      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: false, amount: 0.3 }}
        variants={{
          hidden: { opacity: 0, scale: 0.95, y: 30 },
          visible: { 
            opacity: 1, 
            scale: 1, 
            y: 0,
            transition: { 
              duration: 1, 
              staggerChildren: 0.2,
              ease: "easeOut"
            } 
          }
        } as const}
        className="max-w-3xl glass-card p-12 backdrop-blur-md bg-black/20"
      >
        <motion.h2 
          variants={{
            hidden: { opacity: 0, y: 20 },
            visible: { opacity: 1, y: 0 }
          }}
          className="text-4xl md:text-5xl font-bold mb-8"
        >
          Chapter IV: The Slow Farewell
        </motion.h2>
        <motion.div 
          variants={{
            hidden: { opacity: 0, scale: 0.8 },
            visible: { opacity: 1, scale: 1 }
          }}
          className="mb-12"
        >
          <div className="text-8xl md:text-[12rem] font-bold text-white/10 relative">
            {distance}
            <span className="text-2xl md:text-4xl absolute bottom-4 right-0 md:-right-20 text-earth-blue">cm/year</span>
          </div>
        </motion.div>
        <motion.p 
          variants={{
            hidden: { opacity: 0, y: 20 },
            visible: { opacity: 1, y: 0 }
          }}
          className="text-lg md:text-xl text-white/60 leading-relaxed"
        >
          The Moon is slowly drifting away. Every year, it moves 3.8 centimeters further into the void. One day, billions of years from now, it may leave Earth's embrace forever.
        </motion.p>
      </motion.div>
    </section>
  );
};

const CopyrightSection = () => {
  return (
    <section className="h-screen flex flex-col items-center justify-center text-center ui-overlay">
      {/* Empty section to allow space for the copyright text to move to the center */}
    </section>
  );
};

export default function App() {
  const journeyRef = useRef<HTMLDivElement>(null);
  const mouse = useRef<[number, number]>([0, 0]);
  const { scrollYProgress } = useScroll();
  const [atmosphereDensity] = useState(0.3);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);

  const toggleMusic = () => setIsMusicPlaying(!isMusicPlaying);

  const startJourney = () => {
    journeyRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mouse.current = [
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1,
      ];
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <main className="relative bg-black">
      <div className="canvas-container">
        <Canvas shadows gl={{ antialias: true }}>
          <Suspense fallback={null}>
            <Scene scrollYProgress={scrollYProgress} mouse={mouse} atmosphereDensity={atmosphereDensity} />
          </Suspense>
        </Canvas>
      </div>

      <div className="relative z-10">
        <BackgroundMusic isPlaying={isMusicPlaying} toggleMusic={toggleMusic} />
      <Hero onStart={startJourney} scrollYProgress={scrollYProgress} isMusicPlaying={isMusicPlaying} toggleMusic={toggleMusic} />
        <div ref={journeyRef}>
          <CollisionSection />
          <StabilizerSection />
          <TidalSection />
          <FarewellSection />
          <CopyrightSection />
        </div>
      </div>
      
      <SystemOrigin scrollYProgress={scrollYProgress} />
      <motion.div
        className="fixed top-0 left-0 right-0 h-1 bg-earth-blue z-50 origin-left"
        style={{ scaleX: useSpring(scrollYProgress, { stiffness: 100, damping: 30 }) }}
      />
      
      {/* Vertical Progress Indicator */}
      <div className="fixed right-4 top-1/2 -translate-y-1/2 h-48 w-px bg-white/10 z-50 hidden md:block">
        <motion.div 
          className="w-full bg-earth-blue shadow-[0_0_15px_rgba(59,130,246,0.8)]"
          style={{ 
            height: useTransform(scrollYProgress, [0, 1], ["0%", "100%"]),
            originY: 0 
          }}
        />
        <div className="absolute -left-1 top-0 w-2 h-2 rounded-full bg-earth-blue/20" />
        <div className="absolute -left-1 bottom-0 w-2 h-2 rounded-full bg-earth-blue/20" />
      </div>
    </main>
  );
}
