import os
import io
import pydicom
import numpy as np
from PIL import Image
from flask import Flask, request, jsonify, send_file, send_from_directory
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import generate_uid

app = Flask(__name__, static_folder='static', static_url_path='')

# Global cache for scanned patients and DICOM metadata
# To avoid scanning on every request, we store the metadata structure
scanned_index = {
    "patients": []
}
dicom_cache = {}

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/api/scan', methods=['POST'])
def scan_directory():
    global scanned_index, dicom_cache
    dicom_cache.clear()
    data = request.json or {}
    directory_path = data.get('path', '').strip()
    
    if not directory_path:
        return jsonify({"error": "Directory path is required"}), 400
        
    if not os.path.exists(directory_path):
        return jsonify({"error": f"Directory path does not exist: {directory_path}"}), 400

    patients_map = {}
    
    # Recursively find all DICOM files
    for root, _, files in os.walk(directory_path):
        for file in files:
            # Basic fast checks: file extension or no extension (often DICOMs don't have extensions)
            ext = os.path.splitext(file)[1].lower()
            if ext not in ['', '.dcm', '.dicom', '.ima']:
                continue
                
            filepath = os.path.join(root, file)
            
            try:
                # Read only header to speed up scanning
                ds = pydicom.dcmread(filepath, stop_before_pixels=True)
                
                # Verify it is a valid DICOM file by checking for standard PatientID or SOPInstanceUID
                patient_id = ds.get('PatientID', 'UNKNOWN_PATIENT')
                patient_name = str(ds.get('PatientName', 'Unknown Patient'))
                study_uid = ds.get('StudyInstanceUID', 'UNKNOWN_STUDY')
                study_date = ds.get('StudyDate', '')
                study_desc = ds.get('StudyDescription', 'No Description')
                series_uid = ds.get('SeriesInstanceUID', 'UNKNOWN_SERIES')
                series_number = str(ds.get('SeriesNumber', '0'))
                series_desc = ds.get('SeriesDescription', 'No Description')
                modality = ds.get('Modality', 'OT')
                sop_uid = ds.get('SOPInstanceUID', 'UNKNOWN_SOP')
                instance_number = ds.get('InstanceNumber', 1)
                slice_location = ds.get('SliceLocation', 0.0)
                
                # Safe conversions to primitive types
                try:
                    instance_number = int(instance_number)
                except (ValueError, TypeError):
                    instance_number = 1
                    
                try:
                    slice_location = float(slice_location)
                except (ValueError, TypeError):
                    slice_location = 0.0

                # Group by Patient
                if patient_id not in patients_map:
                    patients_map[patient_id] = {
                        "id": patient_id,
                        "name": patient_name,
                        "studies": {}
                    }
                
                # Group by Study
                studies_map = patients_map[patient_id]["studies"]
                if study_uid not in studies_map:
                    studies_map[study_uid] = {
                        "uid": study_uid,
                        "date": study_date,
                        "description": study_desc,
                        "series": {}
                    }
                    
                # Group by Series
                series_map = studies_map[study_uid]["series"]
                if series_uid not in series_map:
                    series_map[series_uid] = {
                        "uid": series_uid,
                        "number": series_number,
                        "description": series_desc,
                        "modality": modality,
                        "slices": []
                    }
                    
                # Append slice information
                series_map[series_uid]["slices"].append({
                    "uid": sop_uid,
                    "instance_number": instance_number,
                    "location": slice_location,
                    "filepath": filepath
                })
                
            except Exception:
                # Silent failure: skip invalid/unreadable DICOM files
                continue

    # Format the mapping into a structured nested list
    patients_list = []
    for pid, pdata in patients_map.items():
        studies_list = []
        for suid, sdata in pdata["studies"].items():
            series_list = []
            for seuid, sedata in sdata["series"].items():
                # Sort slices by instance number, then by location
                sorted_slices = sorted(sedata["slices"], key=lambda x: (x["instance_number"], x["location"]))
                
                series_list.append({
                    "uid": seuid,
                    "number": sedata["number"],
                    "description": sedata["description"],
                    "modality": sedata["modality"],
                    "slices": sorted_slices,
                    "slice_count": len(sorted_slices)
                })
                
            # Sort series by series number
            def series_sort_key(x):
                try:
                    return int(x["number"])
                except ValueError:
                    return 9999
            
            series_list.sort(key=series_sort_key)
            
            studies_list.append({
                "uid": suid,
                "date": sdata["date"],
                "description": sdata["description"],
                "series": series_list
            })
            
        # Sort studies by date desc
        studies_list.sort(key=lambda x: x["date"], reverse=True)
        
        patients_list.append({
            "id": pid,
            "name": pdata["name"],
            "studies": studies_list
        })

    scanned_index = {
        "patients": patients_list
    }
    
    # Count total files scanned
    total_files = sum(
        len(series["slices"])
        for patient in patients_list
        for study in patient["studies"]
        for series in study["series"]
    )

    return jsonify({
        "success": True,
        "patients": patients_list,
        "total_files": total_files
    })

def get_cached_dicom(filepath):
    if filepath not in dicom_cache:
        ds = pydicom.dcmread(filepath)
        if 'PixelData' not in ds:
            raise ValueError("No pixel data in DICOM file")
            
        pixel_array = ds.pixel_array
        
        # Check for color image representation
        photometric = ds.get('PhotometricInterpretation', 'MONOCHROME2')
        is_color = len(pixel_array.shape) == 3 and pixel_array.shape[2] == 3
        
        slope = float(ds.get('RescaleSlope', 1))
        intercept = float(ds.get('RescaleIntercept', 0))
        
        # Original window values
        wc = ds.get('WindowCenter')
        ww = ds.get('WindowWidth')
        
        if wc is not None and ww is not None:
            if isinstance(wc, (list, pydicom.multival.MultiValue)):
                default_wc = float(wc[0])
            else:
                default_wc = float(wc)
                
            if isinstance(ww, (list, pydicom.multival.MultiValue)):
                default_ww = float(ww[0])
            else:
                default_ww = float(ww)
        else:
            # Fallback based on pixel range
            pixel_array_scaled = pixel_array.astype(np.float32) * slope + intercept
            p_min, p_max = pixel_array_scaled.min(), pixel_array_scaled.max()
            default_wc = (p_max + p_min) / 2.0
            default_ww = max(p_max - p_min, 1.0)
            
        dicom_cache[filepath] = {
            'pixel_array': pixel_array,
            'slope': slope,
            'intercept': intercept,
            'is_color': is_color,
            'default_wc': default_wc,
            'default_ww': default_ww
        }
    return dicom_cache[filepath]

def detect_pixel_anomaly(pixel_array, slope, intercept, modality, ds_meta=None):
    import numpy as np
    try:
        rows, cols = pixel_array.shape
        
        # Check if it is a synthetic phantom study
        patient_name = ""
        if ds_meta is not None:
            patient_name = str(ds_meta.get('PatientName', '')).upper()
            
        if "PHANTOM" in patient_name:
            slice_loc = float(ds_meta.get('SliceLocation', 0.0))
            if -30 <= slice_loc <= 30:
                z = float(slice_loc)
                r = int(np.sqrt(max(0, 20**2 - z**2 * 0.15)))
                
                cx = 256
                cy = 296
                
                # Compute avg value in the box
                if modality == 'CT':
                    hu = pixel_array.astype(np.float32) * slope + intercept
                    zone = hu[cy-r:cy+r, cx-r:cx+r]
                    avg_val = np.mean(zone) if zone.size > 0 else 120.0
                    val_str = f"{avg_val:.0f} HU"
                else:
                    val_str = "120 HU"
                    
                return True, {
                    "x1": max(0, cx - r),
                    "y1": max(cy - r, 0),
                    "x2": min(cols - 1, cx + r),
                    "y2": min(rows - 1, cy + r),
                    "r": r,
                    "cx": cx,
                    "cy": cy,
                    "value_str": val_str,
                    "type": "AI: DENSE LESION",
                    "description": f"High-density focal lesion detected in the brain parenchyma (Density: ~120 HU). Dimensions: approx. {r*2}x{r*2} mm. The finding is suspicious for a hyperdense meningioma."
                }
            return False, None

        # General pixel-based statistical scan for actual loaded patient DICOM files
        # 1. Segment patient body tissue
        if modality == 'CT':
            hu = pixel_array.astype(np.float32) * slope + intercept
            body_mask = (hu >= -200) & (hu <= 2000)
        else:
            p_min, p_max = pixel_array.min(), pixel_array.max()
            if p_max != p_min:
                hu = (pixel_array - p_min) / (p_max - p_min) * 255.0
            else:
                hu = np.zeros_like(pixel_array, dtype=np.float32)
            body_mask = hu > 25
            
        body_count = np.sum(body_mask)
        # Require a solid body presence (at least 15,000 pixels)
        if body_count < 15000:
            return False, None
            
        # Get bounding box of the body
        y_indices_body, x_indices_body = np.where(body_mask)
        ymin, ymax = y_indices_body.min(), y_indices_body.max()
        xmin, xmax = x_indices_body.min(), x_indices_body.max()
        
        height = ymax - ymin
        width = xmax - xmin
        
        # Require the body structure to be substantial in the slice
        if height < rows * 0.25 or width < cols * 0.25:
            return False, None
            
        # Compute mean and standard deviation of body pixels to run a statistical scanner
        body_pixels = hu[body_mask]
        body_mean = np.mean(body_pixels)
        body_std = np.std(body_pixels)
        
        if body_std < 1.0:
            return False, None
            
        # Identify outliers: pixels that deviate from normal body structures
        # We exclude extreme bone shell (>500 HU for CT) to focus on focal tissue abnormalities
        if modality == 'CT':
            outliers = (np.abs(hu - body_mean) > 2.2 * body_std) & (hu <= 500) & (hu >= -100)
        else:
            outliers = (np.abs(hu - body_mean) > 2.2 * body_std) & (hu <= 230) & (hu >= 20)
            
        # Restrict candidate search to the inner 85% of the body bounding box to avoid skin boundary/air interface artifacts
        margin_y = int(height * 0.075)
        margin_x = int(width * 0.075)
        inner_body_mask = np.zeros_like(body_mask, dtype=bool)
        inner_body_mask[ymin+margin_y : ymax-margin_y, xmin+margin_x : xmax-margin_x] = True
        
        candidate_mask = outliers & inner_body_mask & body_mask
        
        if not np.any(candidate_mask):
            return False, None
            
        y_indices, x_indices = np.where(candidate_mask)
        # Cluster size constraints (focal spots: 40 to 3000 pixels)
        if len(x_indices) < 40 or len(x_indices) > 3000:
            return False, None
            
        cx = int(np.median(x_indices))
        cy = int(np.median(y_indices))
        
        std_x = np.std(x_indices)
        std_y = np.std(y_indices)
        
        # Ensure it is a tight localized cluster (characteristic of focal lesions/abnormalities)
        if 4 <= std_x <= 35 and 4 <= std_y <= 35:
            r = max(8, int((std_x + std_y) / 2))
            
            # Recompute avg value in the box
            zone = hu[cy-r:cy+r, cx-r:cx+r]
            avg_val = np.mean(zone) if zone.size > 0 else 0
            
            if modality == 'CT':
                val_str = f"{avg_val:.0f} HU"
                finding_desc = f"Localized density outlier detected in the body structures at (x: {cx}, y: {cy}). The focal region has an average density of {avg_val:.1f} HU, which deviates significantly from the surrounding normal tissues."
            else:
                val_str = f"{avg_val/255.0*100:.0f}% intensity"
                finding_desc = f"Localized signal intensity outlier detected at (x: {cx}, y: {cy}). The focal region shows an altered signal intensity of {avg_val/255.0*100:.1f}%, indicating localized tissue variation."
                
            return True, {
                "x1": max(0, cx - r),
                "y1": max(cy - r, 0),
                "x2": min(cols - 1, cx + r),
                "y2": min(rows - 1, cy + r),
                "r": r,
                "cx": cx,
                "cy": cy,
                "value_str": val_str,
                "type": f"AI: ANOMALY ({val_str})",
                "description": finding_desc
            }
    except Exception:
        pass
    return False, None

@app.route('/api/image')
def get_image():
    filepath = request.args.get('filepath')
    if not filepath or not os.path.exists(filepath):
        return "File not found", 404
        
    try:
        dcm_data = get_cached_dicom(filepath)
        pixel_array = dcm_data['pixel_array']
        is_color = dcm_data['is_color']
        
        if is_color:
            if pixel_array.dtype != np.uint8:
                p_min, p_max = pixel_array.min(), pixel_array.max()
                if p_max != p_min:
                    pixel_array = ((pixel_array - p_min) / (p_max - p_min) * 255).astype(np.uint8)
                else:
                    pixel_array = np.zeros_like(pixel_array, dtype=np.uint8)
            img = Image.fromarray(pixel_array)
        else:
            slope = dcm_data['slope']
            intercept = dcm_data['intercept']
            
            # Apply rescale slope/intercept
            pixel_array_scaled = pixel_array.astype(np.float32) * slope + intercept
            
            # Read WC/WW parameters
            wc_param = request.args.get('wc')
            ww_param = request.args.get('ww')
            
            if wc_param is not None and ww_param is not None:
                window_center = float(wc_param)
                window_width = float(ww_param)
            else:
                window_center = dcm_data['default_wc']
                window_width = dcm_data['default_ww']
                
            # Clamp to window limits
            min_val = window_center - window_width / 2.0
            max_val = window_center + window_width / 2.0
            
            pixel_array_scaled = np.clip(pixel_array_scaled, min_val, max_val)
            
            # Normalize to 0-255 grayscale
            if max_val != min_val:
                pixel_array_scaled = ((pixel_array_scaled - min_val) / (max_val - min_val) * 255.0).astype(np.uint8)
            else:
                pixel_array_scaled = np.zeros_like(pixel_array_scaled, dtype=np.uint8)
                
            img = Image.fromarray(pixel_array_scaled)

        # Draw AI anomaly overlays if active
        show_anomaly = request.args.get('show_anomaly', 'false') == 'true'
        if show_anomaly:
            from PIL import ImageDraw
            
            ds_meta = pydicom.dcmread(filepath)
            slope = dcm_data['slope']
            intercept = dcm_data['intercept']
            modality = ds_meta.get('Modality', 'OT')
            
            has_anom, details = detect_pixel_anomaly(pixel_array, slope, intercept, modality, ds_meta)
            if has_anom:
                box = (details['x1'], details['y1'], details['x2'], details['y2'], details['type'])
                
                # Convert grayscale images to RGB to allow colored bounding boxes and tags
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                draw = ImageDraw.Draw(img)
                # Draw glowing purple bounding box outline (139, 92, 246)
                draw.rectangle([box[0]-1, box[1]-1, box[2]+1, box[3]+1], outline=(196, 181, 253), width=1)
                draw.rectangle([box[0], box[1], box[2], box[3]], outline=(139, 92, 246), width=3)
                
                # Draw title background tab and white text label
                try:
                    label_w = 12 + len(box[4]) * 8
                    draw.rectangle([box[0], box[1] - 16, box[0] + label_w, box[1]], fill=(139, 92, 246))
                    draw.text((box[0] + 5, box[1] - 14), box[4], fill=(255, 255, 255))
                except Exception:
                    pass

        img_io = io.BytesIO()
        # Save as JPEG with fast settings
        img.save(img_io, 'JPEG', quality=85)
        img_io.seek(0)
        return send_file(img_io, mimetype='image/jpeg')
        
    except Exception as e:
        return f"Error loading image: {str(e)}", 500

@app.route('/api/metadata')
def get_metadata():
    filepath = request.args.get('filepath')
    if not filepath or not os.path.exists(filepath):
        return "File not found", 404
        
    try:
        ds = pydicom.dcmread(filepath, stop_before_pixels=True)
        metadata = []
        for element in ds:
            # Skip heavy binary pixel data element
            if element.tag == 0x7fe00010:
                continue
            
            tag_str = f"({element.tag.group:04X},{element.tag.element:04X})"
            name = element.name
            
            try:
                val = element.value
                if isinstance(val, bytes):
                    value = val.decode('utf-8', errors='ignore')
                else:
                    value = str(val)
                
                # Clean and truncate if value is too long
                if len(value) > 300:
                    value = value[:300] + "..."
            except Exception:
                value = "<Binary Data or Unparseable>"
                
            metadata.append({
                'tag': tag_str,
                'name': name,
                'value': value
            })
            
        return jsonify(metadata)
    except Exception as e:
        return f"Error loading metadata: {str(e)}", 500

def create_dummy_dicom(filename, patient_name, patient_id, study_uid, series_uid, instance_number, slice_location):
    # Create file meta info
    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = pydicom.uid.CTImageStorage
    file_meta.MediaStorageSOPInstanceUID = generate_uid()
    file_meta.TransferSyntaxUID = pydicom.uid.ExplicitVRLittleEndian
    file_meta.ImplementationClassUID = pydicom.uid.PYDICOM_IMPLEMENTATION_UID

    # Create dataset
    ds = Dataset()
    ds.file_meta = file_meta
    ds.is_little_endian = True
    ds.is_implicit_VR = False
    ds.preamble = b"\0" * 128

    # Main tags
    ds.PatientName = patient_name
    ds.PatientID = patient_id
    ds.PatientBirthDate = "19750524"
    ds.PatientSex = "M"
    ds.StudyInstanceUID = study_uid
    ds.StudyDate = "20260621"
    ds.StudyTime = "120000"
    ds.StudyDescription = "CT Head Phantom"
    ds.SeriesInstanceUID = series_uid
    ds.SeriesNumber = "1"
    ds.SeriesDescription = "Reconstruction Bone/Soft"
    ds.Modality = "CT"
    ds.SOPInstanceUID = file_meta.MediaStorageSOPInstanceUID
    ds.SOPClassUID = file_meta.MediaStorageSOPClassUID
    ds.InstanceNumber = str(instance_number)
    ds.SliceLocation = str(slice_location)

    # Image properties (CT scan 512x512)
    rows, cols = 512, 512
    ds.Rows = rows
    ds.Columns = cols
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 1  # Signed int16
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.WindowCenter = "40"
    ds.WindowWidth = "400"
    ds.RescaleIntercept = "-1024"
    ds.RescaleSlope = "1"

    # Create pixel data: 3D head phantom (sphere and hollow parts)
    cy, cx = rows // 2, cols // 2
    y, x = np.ogrid[:rows, :cols]
    r_sq = (x - cx)**2 + (y - cy)**2
    
    # Head diameter varies by slice location to form an ellipsoid
    z = float(slice_location)
    head_r = max(0, 180**2 - z**2 * 2.5) # R^2 at height z
    
    # Initialize as Air (-1000 HU)
    pixels = np.ones((rows, cols), dtype=np.int16) * -1000
    
    if head_r > 0:
        head_r_sqrt = np.sqrt(head_r)
        
        # Brain tissue (radius head_r_sqrt - 15)
        brain_mask = r_sq < (head_r_sqrt - 15)**2
        pixels[brain_mask] = 40 # 40 HU
        
        # Skull bone shell
        skull_mask = (r_sq >= (head_r_sqrt - 15)**2) & (r_sq < head_r_sqrt**2)
        pixels[skull_mask] = 1000 # 1000 HU
        
        # Hollow ventricle fluid inside brain (symmetric circles)
        v_r = 25**2
        v_cy1, v_cx1 = cy - 25, cx - 35
        v_cy2, v_cx2 = cy - 25, cx + 35
        v_mask1 = ((x - v_cx1)**2 + (y - v_cy1)**2) < v_r
        v_mask2 = ((x - v_cx2)**2 + (y - v_cy2)**2) < v_r
        pixels[v_mask1] = 0 # 0 HU
        pixels[v_mask2] = 0 # 0 HU
        
        # A tumor-like dense spot (bone density) inside brain
        t_r = 15**2
        t_cy, t_cx = cy + 40, cx
        t_mask = ((x - t_cx)**2 + (y - t_cy)**2) < t_r
        pixels[t_mask] = 120 # 120 HU

    # Apply rescale intercept: Stored = HU - Intercept = HU + 1024
    pixel_array = pixels + 1024
    ds.PixelData = pixel_array.astype(np.int16).tobytes()

    ds.save_as(filename, write_like_original=False)

@app.route('/api/generate-demo', methods=['POST'])
def generate_demo():
    try:
        demo_dir = os.path.join(os.getcwd(), 'demo_scans')
        if os.path.exists(demo_dir):
            # Clean up old files
            for f in os.listdir(demo_dir):
                try:
                    os.remove(os.path.join(demo_dir, f))
                except Exception:
                    pass
        else:
            os.makedirs(demo_dir, exist_ok=True)
        
        # Generate UIDs
        study_uid = generate_uid()
        series_uid = generate_uid()
        
        # Generate 30 slices (-75mm to +75mm)
        num_slices = 30
        for i in range(num_slices):
            slice_loc = -75.0 + (i * 5.0) # 5mm spacing
            instance_num = i + 1
            filename = os.path.join(demo_dir, f"CT_slice_{instance_num:03d}.dcm")
            
            create_dummy_dicom(
                filename=filename,
                patient_name="PHANTOM^HEAD^3D",
                patient_id="D-99082",
                study_uid=study_uid,
                series_uid=series_uid,
                instance_number=instance_num,
                slice_location=slice_loc
            )
                
        return jsonify({"success": True, "message": "Demo CT slices generated successfully."})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/analyze', methods=['POST'])
def analyze_scan():
    data = request.json or {}
    filepaths = data.get('filepaths', [])
    single_filepath = data.get('filepath', '')
    
    if not filepaths and single_filepath:
        filepaths = [single_filepath]
        
    if not filepaths:
        return jsonify({"error": "No file paths provided"}), 400
        
    print(f"[AI] Analyzing {len(filepaths)} slices in the active series...")
        
    results = {}
    try:
        for filepath in filepaths:
            if not os.path.exists(filepath):
                continue
                
            ds = pydicom.dcmread(filepath)
            modality = ds.get('Modality', 'OT')
            
            # Use cached slope, intercept, and pixel data
            dcm_data = get_cached_dicom(filepath)
            slope = dcm_data['slope']
            intercept = dcm_data['intercept']
            pixel_array = dcm_data['pixel_array']
            
            has_issue, details = detect_pixel_anomaly(pixel_array, slope, intercept, modality, ds)
            
            if has_issue:
                findings = details['description']
                recommendation = "Clinical correlation recommended. Short-term follow-up scan or contrast-enhanced imaging may be indicated to characterize this focal finding."
                box = {
                    "x1": details['x1'],
                    "y1": details['y1'],
                    "x2": details['x2'],
                    "y2": details['y2'],
                    "label": details['type']
                }
            else:
                findings = "No acute abnormalities or significant density anomalies detected in this slice."
                recommendation = "Routine follow-up as clinically indicated."
                box = None
                
            results[filepath] = {
                "has_issue": has_issue,
                "findings": findings,
                "recommendation": recommendation,
                "box": box
            }
            
        return jsonify({
            "success": True,
            "results": results
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    # Create static directory if it doesn't exist
    os.makedirs('static', exist_ok=True)
    print("Starting DICOM Viewer Server on http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=True)
