import { Route, Routes } from 'react-router-dom'
import Navbar from './components/Navbar.jsx'
import Home from './pages/Home.jsx'
import MapPage from './pages/MapPage.jsx'
import VRPage from './pages/VRPage.jsx'
import Credits from './pages/Credits.jsx'
import './App.css'

export default function App() {
  return (
    <>
      <Navbar />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/vr" element={<VRPage />} />
          <Route path="/credits" element={<Credits />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
    </>
  )
}
